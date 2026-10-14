import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { apiRoutes } from "./routes";
import { serveApp } from "./app";
import type { Config } from "@di/shared";
import { createDatabase, migrate } from "../store/db";

const servers: ReturnType<typeof Bun.serve>[] = [];

afterEach(() => {
  for (const s of servers) s.stop(true);
  servers.length = 0;
});

/**
 * Stub upstream for relay tests. Records the last request per path so tests
 * can assert what actually crossed the relay (method, body, headers).
 */
interface UpstreamRecord {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

interface UpstreamOptions {
  /** Handler for the request; defaults to echoing method+path as json. */
  handle?: (req: Request) => Response | Promise<Response>;
}

function startUpstream(opts: UpstreamOptions = {}): {
  url: string;
  requests: UpstreamRecord[];
  server: ReturnType<typeof Bun.serve>;
} {
  const requests: UpstreamRecord[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      requests.push({
        method: req.method,
        path: new URL(req.url).pathname,
        headers: Object.fromEntries(req.headers.entries()),
        body: await req.text(),
      });
      return opts.handle
        ? await opts.handle(req)
        : Response.json({ path: new URL(req.url).pathname });
    },
  });
  servers.push(server);
  return { url: `http://localhost:${server.port}`, requests, server };
}

async function makeRelayApp(): Promise<Hono> {
  const db = createDatabase(":memory:");
  await migrate(db);
  const app = new Hono();
  app.route("/v1", apiRoutes(db, { testMode: false }));
  return app;
}

function relayPath(upstream: string): string {
  return `/v1/relay?url=${encodeURIComponent(upstream)}`;
}

describe("GET/POST /v1/relay passthrough", () => {
  it("GET relays status, body, and content-type", async () => {
    const up = startUpstream({
      handle: () =>
        new Response('{"ok":true}', { headers: { "content-type": "application/json" } }),
    });
    const app = await makeRelayApp();
    const res = await app.request(relayPath(`${up.url}/v1/models`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.text()).toBe('{"ok":true}');
    expect(up.requests[0]!.method).toBe("GET");
  });

  it("POST forwards the body and the authorization header", async () => {
    const up = startUpstream();
    const app = await makeRelayApp();
    const res = await app.request(relayPath(`${up.url}/v1/chat/completions`), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-key",
        cookie: "session=leak",
        origin: "http://localhost:5173",
      },
      body: JSON.stringify({ model: "m", messages: [] }),
    });
    expect(res.status).toBe(200);
    const seen = up.requests[0]!;
    expect(seen.method).toBe("POST");
    expect(seen.body).toBe(JSON.stringify({ model: "m", messages: [] }));
    expect(seen.headers["authorization"]).toBe("Bearer test-key");
    expect(seen.headers["content-type"]).toContain("application/json");
  });

  it("drops cookie/origin: only allowlisted headers reach upstream", async () => {
    const up = startUpstream();
    const app = await makeRelayApp();
    await app.request(relayPath(`${up.url}/v1/chat/completions`), {
      method: "POST",
      headers: {
        authorization: "Bearer k",
        cookie: "session=leak",
        origin: "http://localhost:5173",
        "x-custom": "nope",
        referer: "http://localhost:5173/setup",
        "user-agent": "spoof-me",
      },
      body: "{}",
    });
    const seen = up.requests[0]!.headers;
    expect(seen["authorization"]).toBe("Bearer k");
    expect(seen["cookie"]).toBeUndefined();
    expect(seen["origin"]).toBeUndefined();
    expect(seen["x-custom"]).toBeUndefined();
    expect(seen["referer"]).toBeUndefined();
    // fetch adds its own default user-agent when none is forwarded; the
    // client-supplied one must not survive the allowlist.
    expect(seen["user-agent"]).not.toBe("spoof-me");
  });

  it("relays upstream 401 to the client", async () => {
    const up = startUpstream({
      handle: () =>
        new Response("no key", { status: 401, headers: { "content-type": "text/plain" } }),
    });
    const app = await makeRelayApp();
    const res = await app.request(relayPath(`${up.url}/v1/chat/completions`), { method: "POST" });
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("no key");
  });

  it("rejects non-http(s) schemes and missing url with 400", async () => {
    const app = await makeRelayApp();
    const badScheme = await app.request(relayPath("file:///etc/passwd"));
    expect(badScheme.status).toBe(400);
    const body = (await badScheme.json()) as { error: string; code: string };
    expect(body.code).toBe("relay_bad_url");
    const missing = await app.request("/v1/relay");
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { code: string }).code).toBe("relay_bad_url");
  });

  it("502s with relay_upstream when upstream is unreachable", async () => {
    const app = await makeRelayApp();
    // port 1 on loopback: nothing listens there
    const res = await app.request(relayPath("http://127.0.0.1:1/nope"));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("relay_upstream");
  });

  it("streams SSE chunks in order without buffering", async () => {
    const chunks = ["data: first\n\n", "data: second\n\n", "data: [DONE]\n\n"];
    const up = startUpstream({
      handle: () =>
        new Response(
          new ReadableStream({
            async start(controller) {
              for (const chunk of chunks) {
                controller.enqueue(new TextEncoder().encode(chunk));
                await Bun.sleep(30);
              }
              controller.close();
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    });
    const app = await makeRelayApp();
    const res = await app.request(relayPath(`${up.url}/v1/chat/completions`), { method: "POST" });
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const received: string[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received.push(decoder.decode(value, { stream: true }));
    }
    expect(received.join("")).toBe(chunks.join(""));
    // multiple reads means the body was not fully buffered before first read
    expect(received.length).toBeGreaterThanOrEqual(chunks.length);
  });

  it("aborts the upstream request when the client aborts", async () => {
    // tracks the upstream response streams still open: 1 while streaming, 0
    // once the relay's abort tears the connection down.
    let open = 0;
    const cancelled = Promise.withResolvers<void>();
    const up = Bun.serve({
      port: 0,
      fetch: () => {
        open++;
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("data: hold\n\n"));
          },
          cancel() {
            open--;
            cancelled.resolve();
          },
        });
        return new Response(stream, { headers: { "content-type": "text/event-stream" } });
      },
    });
    servers.push(up);

    // abort propagation only exists over a real socket, so the relay runs
    // under Bun.serve (serveApp) instead of app.request.
    const db = createDatabase(":memory:");
    await migrate(db);
    const app = new Hono();
    app.route("/v1", apiRoutes(db, { testMode: false }));
    const server = serveApp(app, 0, {
      config: {
        server: { port: 0, auth: "none" },
        llm: { provider: "mock", base_url: "http://localhost:9", model: "m", flavor: "openai" },
        stt: { base_url: "http://localhost:9", model: "s", mode: "buffered" },
        tts: { base_url: "http://localhost:9", model: "t", voice: "v" },
        files: { db_path: ":memory:", log_path: "", data_dir: "" },
      } satisfies Config,
      db,
    });
    servers.push(server);

    const controller = new AbortController();
    const res = await fetch(
      `http://localhost:${server.port}/v1/relay?url=${encodeURIComponent(`http://localhost:${up.port}/v1/chat/completions`)}`,
      { method: "POST", signal: controller.signal },
    );
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value!)).toContain("data: hold");
    expect(open).toBe(1);

    controller.abort();
    await cancelled.promise;
    await waitFor(() => (open === 0 ? true : undefined));
    expect(open).toBe(0);
  });
});

function waitFor<T>(probe: () => T | undefined, ms = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const v = probe();
      if (v !== undefined) return resolve(v);
      if (Date.now() - started > ms) return reject(new Error("waitFor timeout"));
      setTimeout(tick, 25);
    };
    tick();
  });
}

async function makeApp(testMode = false) {
  const db = createDatabase(":memory:");
  await migrate(db);
  const app = new Hono();
  app.route("/v1", apiRoutes(db, { testMode }));
  return app;
}

async function makeSession(app: Hono): Promise<string> {
  const res = await app.request("/v1/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "t", mode: "interview", duration_min: 30 }),
  });
  const body = (await res.json()) as { id: string };
  return body.id;
}

describe("tool state routes", () => {
  it("returns empty tool state before any push", async () => {
    const app = await makeApp();
    const id = await makeSession(app);
    const res = await app.request(`/v1/sessions/${id}/tools`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });

  it("stores and updates tool state via PUT", async () => {
    const app = await makeApp();
    const id = await makeSession(app);
    const put = (body: unknown) =>
      app.request(`/v1/sessions/${id}/tools`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const res = await put({ editor: "def solve(): pass", whiteboard: "{}" });
    expect(res.status).toBe(200);
    const res2 = await app.request(`/v1/sessions/${id}/tools`);
    expect(await res2.json()).toEqual({
      editor: "def solve(): pass",
      whiteboard: "{}",
    });
    await put({ editor: "updated", whiteboard: "" });
    const res3 = await app.request(`/v1/sessions/${id}/tools`);
    expect(await res3.json()).toEqual({ editor: "updated", whiteboard: "" });
  });

  it("stores arbitrary tool ids beyond editor/whiteboard", async () => {
    const app = await makeApp();
    const id = await makeSession(app);
    const res = await app.request(`/v1/sessions/${id}/tools`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ srs: "cards", editor: "x" }),
    });
    expect(res.status).toBe(200);
    const got = await app.request(`/v1/sessions/${id}/tools`);
    expect(await got.json()).toEqual({ srs: "cards", editor: "x" });
  });

  it("rejects invalid payloads and unknown sessions", async () => {
    const app = await makeApp();
    const id = await makeSession(app);
    const bad = await app.request(`/v1/sessions/${id}/tools`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ editor: 42 }),
    });
    expect(bad.status).toBe(400);
    const missing = await app.request(`/v1/sessions/${crypto.randomUUID()}/tools`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ editor: "", whiteboard: "" }),
    });
    expect(missing.status).toBe(404);
  });

  it("persists a custom toolset on session create and reads it back", async () => {
    const app = await makeApp();
    const res = await app.request("/v1/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "t",
        mode: "interview",
        duration_min: 30,
        tools: { editor: "ts", cards: "" },
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { tools?: Record<string, string> };
    expect(body.tools).toEqual({ editor: "ts", cards: "" });
    const listed = await app.request("/v1/sessions");
    const sessions = (await listed.json()) as { tools?: Record<string, string> }[];
    expect(sessions[0]!.tools).toEqual({ editor: "ts", cards: "" });
  });

  it("defaults sessions created without tools to editor+whiteboard+code", async () => {
    const app = await makeApp();
    const res = await app.request("/v1/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "t", mode: "interview", duration_min: 30 }),
    });
    const body = (await res.json()) as { tools?: Record<string, string> };
    expect(body.tools).toEqual({ editor: "", whiteboard: "", code: "" });
  });
});

describe("test mode smoke route", () => {
  it("returns ok with latency when test mode is on", async () => {
    const app = await makeApp(true);
    const res = await app.request("/v1/test/smoke");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      latency_ms: number;
      session_id: string;
    };
    expect(body.ok).toBe(true);
    expect(typeof body.latency_ms).toBe("number");
    expect(body.session_id).toBeTruthy();
  });

  it("404s when test mode is off", async () => {
    const app = await makeApp(false);
    const res = await app.request("/v1/test/smoke");
    expect(res.status).toBe(404);
  });
});

describe("POST /sessions/:id/report", () => {
  function reportFor(id: string) {
    return {
      session_id: id,
      overall_score: 7,
      coverage_pct: 60,
      competencies: [
        {
          name: "clarity",
          score: 7,
          evidence: [{ quote: "typed question", turn_seq: 0, verdict: "worked" }],
        },
      ],
      model_answers: [],
      generated_at: new Date().toISOString(),
    };
  }

  async function makeReportApp() {
    const db = createDatabase(":memory:");
    await migrate(db);
    const app = new Hono();
    app.route(
      "/v1",
      apiRoutes(db, {
        testMode: false,
        reportLlm: {
          chat: async () => ({ content: "see below", toolCalls: [] }),
        },
      }),
    );
    return { app, db };
  }

  it("generates a report via the llm and returns it idempotently", async () => {
    const db = createDatabase(":memory:");
    await migrate(db);
    const app = new Hono();
    let calls = 0;
    app.route(
      "/v1",
      apiRoutes(db, {
        testMode: false,
        reportLlm: {
          chat: async () => {
            calls++;
            const sessions = await db.selectFrom("sessions").selectAll().execute();
            return {
              content: JSON.stringify(reportFor(sessions[0]!.id)),
              toolCalls: [],
            };
          },
        },
      }),
    );
    const id = await makeSession(app);
    await app.request(`/v1/sessions/${id}/turns`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: crypto.randomUUID(),
        seq: 0,
        speaker: "user",
        text: "typed question",
        created_at: new Date().toISOString(),
        source: "text",
      }),
    });

    const res = await app.request(`/v1/sessions/${id}/report`, { method: "POST" });
    expect(res.status).toBe(201);
    const report = (await res.json()) as { overall_score: number; session_id: string };
    expect(report.overall_score).toBe(7);
    expect(report.session_id).toBe(id);
    expect(calls).toBe(1);

    // second call returns the stored report without hitting the llm
    const again = await app.request(`/v1/sessions/${id}/report`, { method: "POST" });
    expect(again.status).toBe(200);
    expect(calls).toBe(1);
    const session = await db
      .selectFrom("sessions")
      .select("status")
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(session.status).toBe("reported");
  });

  it("503s when no report llm is configured", async () => {
    const app = await makeApp();
    const id = await makeSession(app);
    const res = await app.request(`/v1/sessions/${id}/report`, { method: "POST" });
    expect(res.status).toBe(503);
  });

  it("404s for unknown sessions", async () => {
    const { app } = await makeReportApp();
    const res = await app.request(`/v1/sessions/${crypto.randomUUID()}/report`, {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /sessions/:id and /data", () => {
  it("deletes one session with its children and 404s afterwards", async () => {
    const app = await makeApp();
    const id = await makeSession(app);
    const other = await makeSession(app);
    await app.request(`/v1/sessions/${id}/tools`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ editor: "x" }),
    });
    expect((await app.request(`/v1/sessions/${id}`, { method: "DELETE" })).status).toBe(204);
    expect((await app.request(`/v1/sessions/${id}`)).status).toBe(404);
    expect((await app.request(`/v1/sessions/${id}`, { method: "DELETE" })).status).toBe(404);
    expect((await app.request(`/v1/sessions/${other}`)).status).toBe(200);
  });

  it("DELETE /data wipes every session and reports the count", async () => {
    const app = await makeApp();
    await makeSession(app);
    const id = await makeSession(app);
    await app.request(`/v1/sessions/${id}/tools`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ editor: "x" }),
    });
    const res = await app.request("/v1/data", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, sessions: 2 });
    expect(await (await app.request("/v1/sessions")).json()).toEqual([]);
  });
});
