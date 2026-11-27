import { afterAll, describe, expect, it } from "vitest";
import { SLOW_REASONING_DELAY_MS, loadFixture, startServer } from "../mock-provider/main";

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

describe("mock provider state endpoint", () => {
  it("/__state records the last request headers per path", async () => {
    await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-key" },
      body: JSON.stringify({
        model: "mock-llm",
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    const res = await fetch(`${base}/__state`);
    const state = (await res.json()) as {
      lastHeaders: Record<string, Record<string, string>>;
      inflight: number;
    };
    expect(state.lastHeaders["/v1/chat/completions"]?.authorization).toBe("Bearer test-key");
    expect(state.inflight).toBe(0);
  });

  it("inflight drains to zero after a streamed response completes", async () => {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-llm",
        stream: true,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    expect(res.body).toBeTruthy();
    // drain the stream to completion
    const reader = res.body!.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
    const state = (await (await fetch(`${base}/__state`)).json()) as { inflight: number };
    expect(state.inflight).toBe(0);
  });

  it("inflight drains to zero when the client aborts mid-stream", async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-llm",
        stream: true,
        messages: [{ role: "user", content: "hi" }],
      }),
      signal: ctrl.signal,
    });
    const reader = res.body!.getReader();
    await reader.read();
    ctrl.abort();
    await reader.cancel().catch(() => undefined);
    // the cancel hook is asynchronous; poll briefly for the drain
    for (let i = 0; i < 50; i++) {
      const state = (await (await fetch(`${base}/__state`)).json()) as {
        inflight: number;
      };
      if (state.inflight === 0) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("inflight never drained after abort");
  });
});

describe("mock provider failure injection", () => {
  const failServer = startServer(0, fixture);
  const fb = `http://localhost:${failServer.port}`;
  const setFail = (mode: string | null) =>
    fetch(`${fb}/__fail`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode }),
    });
  const chat = (stream: boolean) =>
    fetch(`${fb}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-llm",
        stream,
        messages: [{ role: "user", content: "hi" }],
      }),
    });

  afterAll(() => failServer.stop(true));

  it("rejects unknown modes", async () => {
    expect((await setFail("nope")).status).toBe(400);
  });

  it("401 mode fails chat and models with a json error, clears with null", async () => {
    await setFail("401");
    const res = await chat(true);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(
      /invalid api key/,
    );
    expect((await fetch(`${fb}/v1/models`)).status).toBe(401);
    await setFail(null);
    expect((await chat(false)).status).toBe(200);
    expect((await fetch(`${fb}/v1/models`)).status).toBe(200);
  });

  it("html-models mode answers 200 html on /models and /v1/models", async () => {
    await setFail("html-models");
    for (const path of ["/models", "/v1/models"]) {
      const res = await fetch(`${fb}${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/text\/html/);
    }
    await setFail(null);
  });

  it("html-root mode breaks only /models, /v1/models stays valid", async () => {
    await setFail("html-root");
    expect((await fetch(`${fb}/models`)).headers.get("content-type")).toMatch(/text\/html/);
    expect(
      ((await (await fetch(`${fb}/v1/models`)).json()) as { data: unknown[] }).data.length,
    ).toBe(fixture.models.length);
    await setFail(null);
    expect((await fetch(`${fb}/models`)).status).toBe(404);
  });

  it("sse-error mode streams an in-band error chunk on a 200, inflight drains", async () => {
    await setFail("sse-error");
    const res = await chat(true);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/"error":\{"message":"upstream exploded/);
    const state = (await (await fetch(`${fb}/__state`)).json()) as { inflight: number };
    expect(state.inflight).toBe(0);
    await setFail(null);
  });

  it("empty-models mode answers a valid empty list", async () => {
    await setFail("empty-models");
    const body = (await (await fetch(`${fb}/v1/models`)).json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
    await setFail(null);
  });

  it("slow-reasoning mode delays the first chunk and streams reasoning before content", async () => {
    await setFail("slow-reasoning");
    const started = Date.now();
    const res = await chat(true);
    const text = await res.text();
    expect(Date.now() - started).toBeGreaterThanOrEqual(SLOW_REASONING_DELAY_MS - 100);
    expect(text.indexOf("reasoning_content")).toBeGreaterThan(-1);
    expect(text.indexOf("reasoning_content")).toBeLessThan(text.indexOf('"content"'));
    await setFail(null);
  }, 15_000);
});
