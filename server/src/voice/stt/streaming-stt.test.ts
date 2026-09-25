import { describe, expect, it } from "vitest";
import { StreamingWhisperStt } from "./streaming-stt.ts";

function pcm(bytes: number): Uint8Array {
  return new Uint8Array(bytes).fill(1);
}

/** SSE response that only completes after `release()` is called. */
function sseResponse(deltas: string[], holdOpen?: { release: () => void }): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const d of deltas) controller.enqueue(enc.encode(d));
      if (holdOpen) {
        holdOpen.release = () => {
          controller.close();
        };
      } else {
        controller.close();
      }
    },
  });
  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
  });
}

describe("StreamingWhisperStt", () => {
  it("accumulates SSE text deltas across feeds and resolves on finish", async () => {
    const requests: { url: string; init: RequestInit }[] = [];
    const stt = new StreamingWhisperStt({
      baseUrl: "http://fake.local",
      model: "whisper-1",
      apiKey: "sk-test",
      fetchImpl: ((url: string, init: RequestInit) => {
        requests.push({ url, init });
        return Promise.resolve(
          sseResponse([
            'data: {"text":"hello "}\n\n',
            'data: {"text":"world"}\n\n',
            "data: [DONE]\n\n",
          ]),
        );
      }) as unknown as typeof fetch,
    });
    await stt.feed(pcm(100));
    await stt.feed(pcm(200));
    const text = await stt.finish();
    expect(text).toBe("hello world");
    expect(requests).toHaveLength(1); // single duplex streaming request
    expect(requests[0]!.url).toContain("/v1/audio/transcriptions?stream=true");
    expect(requests[0]!.url).toContain("model=whisper-1");
    expect((requests[0]!.init.headers as Record<string, string>).authorization).toBe(
      "Bearer sk-test",
    );
    // next utterance opens a fresh session
    const text2 = await stt.finish();
    expect(text2).toBe(""); // nothing fed: buffered fallback returns empty
  });

  it("falls back to a buffered multipart POST when the response is not SSE", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const stt = new StreamingWhisperStt({
      baseUrl: "http://fake.local",
      model: "whisper-1",
      fetchImpl: ((url: string, init: RequestInit) => {
        calls.push({ url, body: init.body });
        if (url.includes("stream=true")) {
          // gateway ignores stream=true and returns plain JSON
          return Promise.resolve(Response.json({ text: "" }));
        }
        return Promise.resolve(Response.json({ text: "buffered transcript" }));
      }) as unknown as typeof fetch,
    });
    await stt.feed(pcm(50));
    const text = await stt.finish();
    expect(text).toBe("buffered transcript");
    expect(calls).toHaveLength(2);
    // the fallback re-posts the fed audio as a WAV multipart form
    const form = calls[1]!.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("model")).toBe("whisper-1");
    const file = form.get("file") as Blob;
    expect(await file.arrayBuffer()).toBeTruthy();
  });

  it("falls back when the streaming request itself fails", async () => {
    let calls = 0;
    const stt = new StreamingWhisperStt({
      baseUrl: "http://fake.local",
      model: "whisper-1",
      fetchImpl: (() => {
        calls++;
        if (calls === 1) return Promise.reject(new Error("network down"));
        return Promise.resolve(Response.json({ text: "late fallback" }));
      }) as unknown as typeof fetch,
    });
    await stt.feed(pcm(20));
    const text = await stt.finish();
    expect(text).toBe("late fallback");
  });

  it("emits stt.request/stt.result events", async () => {
    const events: { type: string; payload?: unknown }[] = [];
    const stt = new StreamingWhisperStt({
      baseUrl: "http://fake.local",
      model: "whisper-1",
      fetchImpl: (() =>
        Promise.resolve(
          sseResponse(['data: {"text":"hi there"}\n\n', "data: [DONE]\n\n"]),
        )) as unknown as typeof fetch,
      events: {
        postEvent: async (_s: string, type: string, payload?: unknown) => {
          events.push({ type, payload });
        },
      },
      sessionId: "s1",
    });
    await stt.feed(pcm(10));
    await stt.finish();
    expect(events.map((e) => e.type)).toEqual(["stt.request", "stt.result"]);
    expect(events[0]!.payload).toMatchObject({ bytes: 10, stream: true });
    expect(events[1]!.payload).toMatchObject({ text_length: 8, stream: true });
  });
});
