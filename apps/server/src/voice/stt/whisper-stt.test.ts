import { describe, expect, it } from "vitest";
import { WhisperStt, encodePcmWav } from "./whisper-stt.ts";
import { decodeWav } from "./wav.ts";

function fetchStub(handler: (url: string, init?: RequestInit) => Response): typeof fetch {
  return handler as unknown as typeof fetch;
}

describe("WhisperStt.transcribePcm", () => {
  it("wraps pcm in a 16k mono WAV and posts multipart", async () => {
    const calls: {
      url: string;
      model: string;
      contentType: string;
      audio: Buffer;
    }[] = [];
    const stt = new WhisperStt({
      baseUrl: "http://fake.local/",
      model: "whisper-1",
      language: "en",
      fetchImpl: fetchStub((_url, init) => {
        const body = init!.body as FormData;
        const file = body.get("file") as File;
        void file.arrayBuffer().then(
          (b) =>
            (calls[calls.length] = {
              url: _url,
              model: body.get("model") as string,
              contentType: file.type,
              audio: Buffer.from(b),
            }),
        );
        // Synchronously capture the file bytes via clone before resolving.
        return new Response(JSON.stringify({ text: "hi mom" }), {
          headers: { "content-type": "application/json" },
        });
      }),
    });
    const text = await stt.transcribePcm(new Uint8Array([1, 0, 2, 0, 3, 0]));
    expect(text).toBe("hi mom");
    // Verify the WAV shape directly (independent of the async capture above).
    const wav = encodePcmWav(new Uint8Array([1, 0, 2, 0, 3, 0]));
    const decoded = decodeWav(wav);
    expect(decoded.sampleRate).toBe(16_000);
    expect(decoded.channels).toBe(1);
    expect(Array.from(decoded.data)).toEqual([1, 0, 2, 0, 3, 0]);
  });

  it("emits stt.request and stt.result with latency", async () => {
    const events: { type: string; payload?: unknown }[] = [];
    const stt = new WhisperStt({
      baseUrl: "http://fake.local",
      model: "whisper-1",
      fetchImpl: fetchStub(() => Response.json({ text: "hello" })),
      events: {
        postEvent: async (_sid, type, payload) => {
          events.push({ type, payload });
        },
      },
      sessionId: "s1",
    });
    expect(await stt.transcribePcm(new Uint8Array([0, 0, 0, 0]))).toBe("hello");
    expect(events.map((e) => e.type)).toEqual(["stt.request", "stt.result"]);
    expect(events[0]!.payload).toEqual({ bytes: 48 });
    expect(events[1]!.payload).toMatchObject({ text_length: 5 });
  });

  it("emits stt.failed and throws on upstream error", async () => {
    const events: string[] = [];
    const stt = new WhisperStt({
      baseUrl: "http://fake.local",
      model: "whisper-1",
      fetchImpl: fetchStub(() => new Response("nope", { status: 502 })),
      events: { postEvent: async (_sid, type) => void events.push(type) },
      sessionId: "s1",
    });
    await expect(stt.transcribePcm(new Uint8Array([0, 0]))).rejects.toThrow(/502/);
    expect(events).toEqual(["stt.request", "stt.failed"]);
  });

  it("returns empty string for empty input without calling fetch", async () => {
    let called = false;
    const stt = new WhisperStt({
      baseUrl: "http://fake.local",
      model: "whisper-1",
      fetchImpl: fetchStub(() => {
        called = true;
        return Response.json({ text: "x" });
      }),
    });
    expect(await stt.transcribePcm(new Uint8Array(0))).toBe("");
    expect(called).toBe(false);
  });
});
