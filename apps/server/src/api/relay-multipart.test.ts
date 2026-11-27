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

interface Seen {
  contentType: string | null;
  authorization: string | null;
  length: number;
  sha256: string;
  fields: Record<string, string>;
  fileType: string;
  fileName: string;
  fileSha256: string;
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Echo upstream: reports content-type, raw body length + sha256, and parsed parts. */
function startEchoUpstream(): string {
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const raw = await req.clone().arrayBuffer();
      const form = await req.formData();
      const file = form.get("file") as File;
      const seen: Seen = {
        contentType: req.headers.get("content-type"),
        authorization: req.headers.get("authorization"),
        length: raw.byteLength,
        sha256: hex(await crypto.subtle.digest("SHA-256", raw)),
        fields: { model: String(form.get("model")) },
        fileType: file.type,
        fileName: file.name,
        fileSha256: hex(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())),
      };
      return Response.json(seen);
    },
  });
  servers.push(server);
  return `http://localhost:${server.port}`;
}

/** Realistic 16-bit mono 16k WAV, ~2.4 MB of pseudo random (incompressible, boundary-hostile) samples. */
function makeWav(seconds: number): Uint8Array<ArrayBuffer> {
  const samples = 16_000 * seconds;
  const data = new Uint8Array(samples * 2);
  crypto.getRandomValues(data);
  const out = new Uint8Array(44 + data.length);
  const dv = new DataView(out.buffer);
  out.set(new TextEncoder().encode("RIFF"), 0);
  dv.setUint32(4, 36 + data.length, true);
  out.set(new TextEncoder().encode("WAVEfmt "), 8);
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, 16_000, true);
  dv.setUint32(28, 32_000, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  out.set(new TextEncoder().encode("data"), 36);
  dv.setUint32(40, data.length, true);
  out.set(data, 44);
  return out;
}

async function startRelayServer(): Promise<string> {
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
  return `http://localhost:${server.port}`;
}

describe("POST /v1/relay multipart (audio/transcriptions)", () => {
  it("forwards a >1MB WAV multipart body byte for byte with its boundary", async () => {
    const upstream = startEchoUpstream();
    const relay = await startRelayServer();
    const wav = makeWav(75);
    expect(wav.byteLength).toBeGreaterThan(1_000_000);

    const form = new FormData();
    form.set("file", new Blob([wav], { type: "audio/wav" }), "audio.wav");
    form.set("model", "whisper-1");

    // serialize once with a Request to learn the exact bytes the client sends
    const probe = new Response(form);
    const sentBlob = await probe.blob();
    const sent = await sentBlob.arrayBuffer();
    const sentHash = hex(await crypto.subtle.digest("SHA-256", sent));
    const sentType = sentBlob.type;
    expect(sentType).toMatch(/^multipart\/form-data; boundary=/);

    const res = await fetch(
      `${relay}/v1/relay?url=${encodeURIComponent(`${upstream}/v1/audio/transcriptions`)}`,
      {
        method: "POST",
        headers: { authorization: "Bearer k", "content-type": sentType },
        body: sent,
      },
    );
    expect(res.status).toBe(200);
    const seen = (await res.json()) as Seen;
    expect(seen.contentType).toBe(sentType);
    expect(seen.authorization).toBe("Bearer k");
    expect(seen.length).toBe(sent.byteLength);
    expect(seen.sha256).toBe(sentHash);
    expect(seen.fields.model).toBe("whisper-1");
    expect(seen.fileName).toBe("audio.wav");
    expect(seen.fileSha256).toBe(hex(await crypto.subtle.digest("SHA-256", wav)));
  });

  it("accepts a FormData body directly (fetch generates the boundary)", async () => {
    const upstream = startEchoUpstream();
    const relay = await startRelayServer();
    const wav = makeWav(40);
    const form = new FormData();
    form.set("file", new Blob([wav], { type: "audio/wav" }), "audio.wav");
    form.set("model", "m");
    const res = await fetch(
      `${relay}/v1/relay?url=${encodeURIComponent(`${upstream}/v1/audio/transcriptions`)}`,
      { method: "POST", body: form },
    );
    const seen = (await res.json()) as Seen;
    expect(seen.contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(seen.fileSha256).toBe(hex(await crypto.subtle.digest("SHA-256", wav)));
  });
});
