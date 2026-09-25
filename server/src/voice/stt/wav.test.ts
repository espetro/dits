import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { WavBuffer, encodeWav, wavHeader } from "./wav.ts";
import type { AudioFrameLike } from "./wav.ts";
import { WhisperStt } from "./whisper-stt.ts";

describe("wav encoding", () => {
  it("writes a valid RIFF header", () => {
    const header = wavHeader(100, { sampleRate: 16000, channels: 1 });
    expect(header.toString("ascii", 0, 4)).toBe("RIFF");
    expect(header.toString("ascii", 8, 12)).toBe("WAVE");
    expect(header.readUInt32LE(24)).toBe(16000); // sample rate
    expect(header.readUInt16LE(22)).toBe(1); // channels
    expect(header.readUInt32LE(40)).toBe(100); // data length
  });

  it("concatenates pcm chunks with a header", () => {
    const pcm = [new Int16Array([1, 2, 3, 4]), new Int16Array([5, 6])];
    const wav = encodeWav(
      pcm.map((a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength)),
      { sampleRate: 16000, channels: 1 },
    );
    expect(wav.length).toBe(44 + 12);
    expect(wav.readUInt32LE(4)).toBe(36 + 12);
    expect(wav.readUInt32LE(40)).toBe(12);
  });

  it("WavBuffer accumulates frames and finalizes", () => {
    const buf = new WavBuffer(16000, 1);
    expect(buf.isEmpty()).toBe(true);
    buf.pushFrame({
      data: new Int16Array([10, 20]),
      sampleRate: 16000,
      numChannels: 1,
    });
    buf.pushFrame({
      data: new Int16Array([30]),
      sampleRate: 16000,
      numChannels: 1,
    });
    expect(buf.isEmpty()).toBe(false);
    expect(buf.byteLength).toBe(6);
    const wav = buf.toWav();
    expect(wav.length).toBe(44 + 6);
    expect(wav.readUInt32LE(24)).toBe(16000);
  });
});

/** Minimal WAV reader for round-trip assertions: header fields + raw PCM bytes. */
function decodeWav(wav: Buffer): {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  data: Buffer;
} {
  return {
    sampleRate: wav.readUInt32LE(24),
    channels: wav.readUInt16LE(22),
    bitsPerSample: wav.readUInt16LE(34),
    data: wav.subarray(44, 44 + wav.readUInt32LE(40)),
  };
}

describe("WavBuffer round-trip (property-based)", () => {
  it("encode-then-decode preserves sample rate, channels, and every pushed sample, for any frame sequence", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1000, max: 192000 }), // sampleRate
        fc.integer({ min: 1, max: 8 }), // numChannels (only affects the header field here; frames are raw PCM)
        fc.array(
          fc.array(fc.integer({ min: -32768, max: 32767 }), {
            minLength: 0,
            maxLength: 64,
          }),
          {
            minLength: 0,
            maxLength: 20,
          },
        ), // sequence of frames, each an arbitrary-length run of Int16 samples
        (sampleRate, numChannels, frames) => {
          const buf = new WavBuffer(sampleRate, numChannels);
          expect(buf.isEmpty()).toBe(true);

          const pushed: AudioFrameLike[] = frames.map((samples) => ({
            data: new Int16Array(samples),
            sampleRate,
            numChannels,
          }));
          for (const frame of pushed) buf.pushFrame(frame);

          const expectedByteLength = frames.reduce((sum, f) => sum + f.length * 2, 0);
          expect(buf.byteLength).toBe(expectedByteLength);
          expect(buf.isEmpty()).toBe(expectedByteLength === 0);

          const decoded = decodeWav(buf.toWav());
          expect(decoded.sampleRate).toBe(sampleRate);
          expect(decoded.channels).toBe(numChannels);
          expect(decoded.bitsPerSample).toBe(16);
          expect(decoded.data.length).toBe(expectedByteLength);

          // Round-trip every sample, not just byte length: decode the PCM
          // back to Int16 and compare against the pushed frames in order.
          const roundTripped = new Int16Array(
            decoded.data.buffer,
            decoded.data.byteOffset,
            decoded.data.byteLength / 2,
          );
          const expectedSamples = frames.flat();
          expect(Array.from(roundTripped)).toEqual(expectedSamples);
        },
      ),
    );
  });
});

describe("WhisperStt", () => {
  it("posts multipart WAV and returns transcript text", async () => {
    const calls: {
      url: string;
      contentType: string;
      model: string;
      audio: Buffer;
    }[] = [];
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      const body = init!.body as FormData;
      const file = body.get("file") as File;
      const audio = Buffer.from(await file.arrayBuffer());
      calls.push({
        url: String(_url),
        contentType: file.type,
        model: body.get("model") as string,
        audio,
      });
      return new Response(JSON.stringify({ text: "hi mom" }), {
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const sttImpl = new WhisperStt({
      baseUrl: "http://fake.local",
      model: "whisper-1",
      fetchImpl,
    });
    const text = await sttImpl.transcribePcm(new Uint8Array([1, 0, 2, 0, 3, 0, 4, 0]));
    expect(text).toBe("hi mom");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://fake.local/v1/audio/transcriptions");
    expect(calls[0]!.model).toBe("whisper-1");
    expect(calls[0]!.contentType).toBe("audio/wav");
    // WAV is properly framed: RIFF header present.
    expect(calls[0]!.audio.toString("ascii", 0, 4)).toBe("RIFF");
  });

  it("throws on upstream error status", async () => {
    const sttImpl = new WhisperStt({
      baseUrl: "http://fake.local",
      model: "whisper-1",
      fetchImpl: (async () => new Response("nope", { status: 502 })) as unknown as typeof fetch,
    });
    await expect(sttImpl.transcribePcm(new Uint8Array([1, 0, 2, 0]))).rejects.toThrow(/502/);
  });
});
