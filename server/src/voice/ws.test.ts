import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";
import { createDatabase, migrate } from "../store/db";
import { apiRoutes } from "../api/routes";
import { serveApp } from "../api/app";
import type { Config } from "@di/shared";
import { VoiceLoop } from "./loop";

function testConfig(): Config {
  return {
    server: { port: 0, auth: "none" },
    llm: { provider: "mock", base_url: "http://localhost:9", model: "m", flavor: "openai" },
    stt: { base_url: "http://localhost:9", model: "s", mode: "buffered" },
    tts: { base_url: "http://localhost:9", model: "t", voice: "v" },
    files: { db_path: ":memory:", log_path: "", data_dir: "" },
  };
}

const servers: ReturnType<typeof Bun.serve>[] = [];

async function makeServer() {
  const db = createDatabase(":memory:");
  await migrate(db);
  const sessionId = crypto.randomUUID();
  await db
    .insertInto("sessions")
    .values({
      id: sessionId,
      title: "ws test",
      mode: "interview",
      created_at: new Date().toISOString(),
      status: "created",
      duration_min: 30,
      plan: null,
    })
    .execute();

  const app = new Hono();
  app.route("/v1", apiRoutes(db, { testMode: true }));

  const loops: VoiceLoop[] = [];
  const server = serveApp(app, 0, {
    config: testConfig(),
    db,
    voiceDeps: {
      loopFactory: (sid, send, sendBinary) => {
        const loop = new VoiceLoop({
          sessionId: sid,
          config: testConfig(),
          db,
          send: send as never,
          sendBinary,
          stt: { transcribePcm: async () => "hello agent" },
          tts: {
            synthesizeToPcm: async () => {
              const pcm = new Uint8Array(960); // one 20ms chunk at 24k
              pcm.fill(1);
              return pcm;
            },
          },
          llm: {
            chat: async () => ({
              content: "Hi, ready when you are.",
              toolCalls: [],
            }),
          },
        });
        loops.push(loop);
        return loop;
      },
    },
  });
  servers.push(server);
  return { server, db, sessionId, loops };
}

afterEach(() => {
  for (const s of servers) s.stop(true);
  servers.length = 0;
});

function waitFor<T>(probe: () => T | undefined, ms = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const v = probe();
      if (v) return resolve(v);
      if (Date.now() - started > ms) return reject(new Error("waitFor timeout"));
      setTimeout(tick, 25);
    };
    tick();
  });
}

describe("voice websocket endpoint", () => {
  it("upgrades, drives a full turn, and 404s unknown sessions", async () => {
    const { server, sessionId, db } = await makeServer();

    // Unknown session rejected before upgrade.
    const bad = await fetch(
      `http://localhost:${server.port}/v1/sessions/${crypto.randomUUID()}/voice`,
      {
        headers: { upgrade: "websocket", connection: "Upgrade" },
      },
    );
    expect(bad.status).toBe(404);

    const ws = new WebSocket(`ws://localhost:${server.port}/v1/sessions/${sessionId}/voice`);
    const messages: { t: string; [k: string]: unknown }[] = [];
    const binary: Uint8Array[] = [];
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") messages.push(JSON.parse(ev.data));
      else binary.push(new Uint8Array(ev.data as ArrayBuffer));
    };
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("ws error"));
    });

    // stream one binary PCM frame (4-byte BE seq + 8 bytes pcm) then utterance_end
    const frame = new Uint8Array(4 + 8);
    new DataView(frame.buffer).setUint32(0, 0, false);
    frame.set(new Uint8Array([1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0]).subarray(0, 8), 4);
    ws.send(frame);
    ws.send(JSON.stringify({ t: "utterance_end" }));

    const done = await waitFor(() =>
      messages.some((m) => m.t === "agent_speaking" && m.on === false) ? messages : undefined,
    );
    expect(done.map((m) => m.t)).toEqual([
      "user_transcript",
      "agent_transcript",
      "agent_speaking",
      "tts",
      "agent_speaking",
      "metrics",
    ]);
    expect(binary).toHaveLength(1);
    expect(binary[0]!.length).toBe(4 + 960);

    const turns = await db.selectFrom("turns").selectAll().orderBy("seq").execute();
    expect(turns.map((t) => [t.speaker, t.text])).toEqual([
      ["user", "hello agent"],
      ["agent", "Hi, ready when you are."],
    ]);
    const events = await db.selectFrom("events").select("type").orderBy("id").execute();
    expect(events.map((e) => e.type)).toContain("agent.started");
    ws.close();
  });
});
