import { describe, expect, it } from "vitest";
import { PocketTts } from "./pocket-tts.ts";
import { encodeWav, wavHeader } from "../stt/wav.ts";

function fetchStub(handler: (url: string, init?: RequestInit) => Response): typeof fetch {
  return handler as unknown as typeof fetch;
}

/** 24k mono WAV of `samples` Int16 values. */
function wav24k(samples: number[]): Uint8Array {
  const pcm = new Uint8Array(samples.length * 2);
  const view = new DataView(pcm.buffer);
  samples.forEach((s, i) => view.setInt16(i * 2, s, true));
  return new Uint8Array(
    Buffer.concat([wavHeader(pcm.length, { sampleRate: 24_000, channels: 1 }), pcm]),
  );
}

function pcmSamples(pcm: Uint8Array): number[] {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  return Array.from({ length: pcm.length / 2 }, (_, i) => view.getInt16(i * 2, true));
}

describe("PocketTts.synthesizeToPcm", () => {
  it("posts the OpenAI speech shape and decodes WAV to PCM16 24k", async () => {
    const bodies: unknown[] = [];
    const tts = new PocketTts({
      baseUrl: "http://fake.local",
      model: "pocket",
      voice: "alloy",
      fetchImpl: fetchStub((_url, init) => {
        bodies.push(JSON.parse(String(init!.body)));
        return new Response(wav24k([1, -2, 3]) as unknown as BodyInit, {
          headers: { "content-type": "audio/wav" },
        });
      }),
    });
    const pcm = await tts.synthesizeToPcm("hello there");
    expect(pcmSamples(pcm)).toEqual([1, -2, 3]);
    expect(bodies[0]).toEqual({
      input: "hello there",
      voice: "alloy",
      model: "pocket",
      response_format: "wav",
    });
  });

  it("resamples an 8k WAV (mock provider shape) to 24k", async () => {
    // 8 input samples at 8k -> 24 output samples at 24k (nearest neighbor).
    const tts = new PocketTts({
      baseUrl: "http://fake.local",
      model: "pocket",
      voice: "alloy",
      fetchImpl: fetchStub(
        () =>
          new Response(
            encodeWav(
              [
                new Uint8Array(
                  new Int16Array([100, -100, 50, -50, 25, -25, 10, -10]).buffer as ArrayBuffer,
                ),
              ],
              {
                sampleRate: 8_000,
                channels: 1,
              },
            ) as unknown as BodyInit,
            { headers: { "content-type": "audio/wav" } },
          ),
      ),
    });
    const pcm = await tts.synthesizeToPcm("x");
    expect(pcm.length / 2).toBe(24);
    expect(pcmSamples(pcm).every((s) => Math.abs(s) <= 100)).toBe(true);
  });

  it("emits tts.request / tts.result and tts.failed events", async () => {
    const events: { type: string; payload?: unknown }[] = [];
    const sink = {
      postEvent: async (_s: string, type: string, payload?: unknown) =>
        void events.push({ type, payload }),
    };
    const tts = new PocketTts({
      baseUrl: "http://fake.local",
      model: "pocket",
      voice: "alloy",
      fetchImpl: fetchStub(() => new Response(wav24k([0, 0]) as unknown as BodyInit)),
      events: sink,
      sessionId: "s1",
    });
    await tts.synthesizeToPcm("ok");
    expect(events.map((e) => e.type)).toEqual(["tts.request", "tts.result"]);
    expect(events[0]!.payload).toEqual({ text_length: 2 });

    events.length = 0;
    const failing = new PocketTts({
      baseUrl: "http://fake.local",
      model: "pocket",
      voice: "alloy",
      fetchImpl: fetchStub(() => new Response("boom", { status: 500 })),
      events: sink,
      sessionId: "s1",
    });
    await expect(failing.synthesizeToPcm("ok")).rejects.toThrow(/500/);
    expect(events.map((e) => e.type)).toEqual(["tts.request", "tts.failed"]);
  });
});
