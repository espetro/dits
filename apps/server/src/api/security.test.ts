import { afterEach, describe, expect, it } from "vitest";
import type { Config } from "@di/shared";
import { createDatabase, migrate } from "../store/db";
import type { VoiceDeps } from "../voice/ws";
import { createApp, serveApp } from "./app";

const servers: ReturnType<typeof Bun.serve>[] = [];

afterEach(() => {
  for (const server of servers) server.stop(true);
  servers.length = 0;
});

function testConfig(server: Partial<Config["server"]> = {}): Config {
  return {
    server: { port: 0, auth: "none", ...server },
    llm: { provider: "mock", base_url: "http://localhost:9", model: "m", flavor: "openai" },
    stt: { base_url: "http://localhost:9", model: "s", mode: "buffered" },
    tts: { base_url: "http://localhost:9", model: "t", voice: "v" },
    files: { db_path: ":memory:", log_path: "", data_dir: "" },
  };
}

interface DiTestServer {
  server: ReturnType<typeof Bun.serve>;
  url: string;
  sessionId: string;
}

function loopFactory(): NonNullable<VoiceDeps["loopFactory"]> {
  return () => ({
    start: async () => undefined,
    handleMessage: async () => undefined,
    close: () => undefined,
  });
}

async function startDi(config = testConfig()): Promise<DiTestServer> {
  const db = createDatabase(":memory:");
  await migrate(db);
  const sessionId = crypto.randomUUID();
  await db
    .insertInto("sessions")
    .values({
      id: sessionId,
      title: "security test",
      mode: "interview",
      created_at: new Date().toISOString(),
      status: "created",
      duration_min: 30,
      plan: null,
      tools: "{}",
    })
    .execute();
  const voiceDeps = { loopFactory: loopFactory() };
  const app = await createApp({ config, db, testMode: false, voiceDeps });
  const server = serveApp(app, 0, { config, db, voiceDeps });
  servers.push(server);
  return { server, url: `http://localhost:${server.port}`, sessionId };
}

function startUpstream(): string {
  const upstream = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => Response.json({ ok: true }),
  });
  servers.push(upstream);
  return `http://localhost:${upstream.port}`;
}

function wsCanOpen(url: string, headers: Record<string, string> = {}): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    // Bun's client accepts headers, while the DOM constructor type only knows protocols.
    const ws = new WebSocket(url, { headers } as never);
    let timer: ReturnType<typeof setTimeout>;
    const finish = (open: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // already closed
      }
      resolve(open);
    };
    timer = setTimeout(() => finish(false), 1000);
    ws.onopen = () => finish(true);
    ws.onerror = () => finish(false);
  });
}

async function responseCode(res: Response): Promise<string> {
  return ((await res.json()) as { code: string }).code;
}

describe("local server security", () => {
  it("binds loopback by default", async () => {
    const { server } = await startDi();
    expect(server.hostname).toBe("127.0.0.1");
  });

  it("allows no-origin and same-origin REST, relay, and websocket requests", async () => {
    const upstream = startUpstream();
    const { url, server, sessionId } = await startDi();
    const sameOrigin = `http://localhost:${server.port}`;
    const relay = `${url}/v1/relay?url=${encodeURIComponent(`${upstream}/v1/models`)}`;

    const headerCases: Record<string, string>[] = [{}, { origin: sameOrigin }];
    for (const headers of headerCases) {
      const sessions = await fetch(`${url}/v1/sessions`, { headers });
      expect(sessions.status).toBe(200);

      const relayed = await fetch(relay, { headers });
      expect(relayed.status).toBe(200);
      expect(await relayed.json()).toEqual({ ok: true });

      const ws = await wsCanOpen(
        `ws://localhost:${server.port}/v1/sessions/${sessionId}/voice`,
        headers,
      );
      expect(ws).toBe(true);
    }
  });

  it("allows explicit dev origins and returns exact CORS headers", async () => {
    const devOrigin = "http://localhost:5173";
    const { url } = await startDi(testConfig({ dev_origins: [devOrigin] }));

    const res = await fetch(`${url}/v1/sessions`, { headers: { origin: devOrigin } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(devOrigin);

    const preflight = await fetch(`${url}/v1/sessions`, {
      method: "OPTIONS",
      headers: { origin: devOrigin },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(devOrigin);
    expect(preflight.headers.get("access-control-allow-headers")).toContain("authorization");
  });

  it("rejects foreign origins on REST, relay, and websocket upgrade", async () => {
    const upstream = startUpstream();
    const { url, server, sessionId } = await startDi();
    const origin = "https://evil.example";
    const relay = `${url}/v1/relay?url=${encodeURIComponent(`${upstream}/v1/models`)}`;

    const rest = await fetch(`${url}/v1/sessions`, { headers: { origin } });
    expect(rest.status).toBe(403);
    expect(rest.headers.get("access-control-allow-origin")).toBeNull();
    expect(await responseCode(rest)).toBe("forbidden_origin");

    const preflight = await fetch(`${url}/v1/sessions`, {
      method: "OPTIONS",
      headers: { origin },
    });
    expect(preflight.status).toBe(403);
    expect(preflight.headers.get("access-control-allow-origin")).toBeNull();

    const relayed = await fetch(relay, { headers: { origin } });
    expect(relayed.status).toBe(403);
    expect(await responseCode(relayed)).toBe("forbidden_origin");

    const ws = await wsCanOpen(`ws://localhost:${server.port}/v1/sessions/${sessionId}/voice`, {
      origin,
    });
    expect(ws).toBe(false);
  });

  it("rejects foreign Host headers on REST and websocket upgrade", async () => {
    const { url, server, sessionId } = await startDi();

    const rest = await fetch(`${url}/v1/sessions`, { headers: { host: "evil.test" } });
    expect(rest.status).toBe(403);
    expect(await responseCode(rest)).toBe("forbidden_host");

    const ws = await wsCanOpen(`ws://localhost:${server.port}/v1/sessions/${sessionId}/voice`, {
      host: "evil.test",
    });
    expect(ws).toBe(false);
  });

  it("fails fast for non-loopback exposure without token auth", async () => {
    const db = createDatabase(":memory:");
    await migrate(db);
    const config = testConfig({ host: "0.0.0.0" });
    await expect(createApp({ config, db, testMode: false })).rejects.toThrow(/non-loopback/);
  });

  it("allows non-loopback exposure when token auth is configured", async () => {
    const db = createDatabase(":memory:");
    await migrate(db);
    const config = testConfig({ host: "0.0.0.0", auth: "token", token: "test-token-123456" });
    await expect(createApp({ config, db, testMode: false })).resolves.toBeDefined();
  });

  it("requires the configured token for REST and voice websocket", async () => {
    const token = "test-token-123456";
    const { url, server, sessionId } = await startDi(testConfig({ auth: "token", token }));

    const health = await fetch(`${url}/api/health`);
    expect(health.status).toBe(200);

    const missing = await fetch(`${url}/v1/sessions`);
    expect(missing.status).toBe(401);
    expect(await responseCode(missing)).toBe("unauthorized");

    const wrong = await fetch(`${url}/v1/sessions`, {
      headers: { authorization: "Bearer wrong-token-0000" },
    });
    expect(wrong.status).toBe(401);

    const correct = await fetch(`${url}/v1/sessions`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(correct.status).toBe(200);

    const wsBase = `ws://localhost:${server.port}/v1/sessions/${sessionId}/voice`;
    expect(await wsCanOpen(wsBase)).toBe(false);
    expect(await wsCanOpen(`${wsBase}?token=wrong-token-0000`)).toBe(false);
    expect(await wsCanOpen(`${wsBase}?token=${encodeURIComponent(token)}`)).toBe(true);
    expect(await wsCanOpen(wsBase, { authorization: `Bearer ${token}` })).toBe(true);
  });
});
