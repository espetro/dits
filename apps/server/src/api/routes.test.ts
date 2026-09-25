import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { apiRoutes } from "./routes";
import { createDatabase, migrate } from "../store/db";

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

  it("defaults sessions created without tools to editor+whiteboard", async () => {
    const app = await makeApp();
    const res = await app.request("/v1/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "t", mode: "interview", duration_min: 30 }),
    });
    const body = (await res.json()) as { tools?: Record<string, string> };
    expect(body.tools).toEqual({ editor: "", whiteboard: "" });
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
