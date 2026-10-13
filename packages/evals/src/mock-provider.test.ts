import { afterAll, describe, expect, it } from "vitest";
import { loadFixture, startServer } from "../mock-provider/main";

const fixture = loadFixture();
const server = startServer(0, fixture);
const base = `http://localhost:${server.port}`;
const noCorsServer = startServer(0, fixture, { noCors: true });
const noCorsBase = `http://localhost:${noCorsServer.port}`;

afterAll(() => {
  server.stop(true);
  noCorsServer.stop(true);
});

describe("mock provider", () => {
  it("GET /health returns ok", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("POST /v1/chat/completions returns fixture content", async () => {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-llm",
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      choices: { message: { content: string } }[];
    };
    expect(body.choices[0]?.message.content).toBe(fixture.chat[0]?.content);
  });

  it("POST /v1/audio/transcriptions returns fixture text", async () => {
    const form = new FormData();
    form.append("file", new Blob(["fake audio"]), "audio.wav");
    const res = await fetch(`${base}/v1/audio/transcriptions`, {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: fixture.transcription });
  });

  it("POST /v1/audio/speech returns audio bytes", async () => {
    const res = await fetch(`${base}/v1/audio/speech`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-tts",
        input: "hello",
        voice: "alloy",
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^audio\//);
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf.length).toBeGreaterThan(44);
    expect(String.fromCharCode(...buf.slice(0, 4))).toBe("RIFF");
  });

  it("GET /v1/models lists fixture models", async () => {
    const res = await fetch(`${base}/v1/models`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string }[] };
    expect(body.data.map((m) => m.id)).toEqual(fixture.models);
  });
});

describe("mock provider cors", () => {
  it("default mode sends CORS headers and answers preflight", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");

    const preflight = await fetch(`${base}/v1/models`, { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("noCors mode strips access-control-* headers and rejects preflight", async () => {
    const res = await fetch(`${noCorsBase}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-allow-methods")).toBeNull();
    expect(res.headers.get("access-control-allow-headers")).toBeNull();

    const preflight = await fetch(`${noCorsBase}/v1/models`, { method: "OPTIONS" });
    expect(preflight.status).toBe(403);
    expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
  });
});
