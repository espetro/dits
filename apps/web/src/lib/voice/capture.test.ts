import { describe, expect, it, vi } from "vitest";
import { MicCaptureImpl, floatToPcm16 } from "./capture";
import type { AudioContextLike } from "./capture";

function fakeDeps() {
  let messageHandler: ((ev: { data: unknown }) => void) | null = null;
  const tracks = [{ stop: vi.fn() }];
  const stream = { getTracks: () => tracks };
  const ctx: AudioContextLike = {
    sampleRate: 16_000,
    audioWorklet: { addModule: async () => undefined },
    createMediaStreamSource: () => ({
      connect: () => undefined,
      disconnect: () => undefined,
    }),
    createAudioWorkletNode: () => ({
      port: {
        get onmessage() {
          return messageHandler;
        },
        set onmessage(cb) {
          messageHandler = cb;
        },
      },
      connect: () => undefined,
      disconnect: () => undefined,
    }),
    close: async () => undefined,
  };
  const deps = {
    audioContextFactory: () => ctx,
    getUserMedia: async () => stream,
    createObjectURL: () => "blob:fake",
  };
  return { deps, emit: (d: unknown) => messageHandler?.({ data: d }), stream };
}

describe("floatToPcm16", () => {
  it("clamps and encodes LE int16", () => {
    const pcm = floatToPcm16(new Float32Array([0, 0.5, -0.5, 2, -2]));
    const view = new DataView(pcm.buffer);
    expect(view.getInt16(0, true)).toBe(0);
    expect(view.getInt16(2, true)).toBe(0x4000);
    expect(view.getInt16(4, true)).toBe(-0x4000);
    expect(view.getInt16(6, true)).toBe(0x7fff);
    expect(view.getInt16(8, true)).toBeLessThanOrEqual(-0x7fff);
  });
});

describe("MicCaptureImpl", () => {
  it("converts worklet floats to pcm16 frames and gates on mute", async () => {
    const cap = new MicCaptureImpl();
    const { deps, emit } = fakeDeps();
    await cap.start(deps);
    const frames: Uint8Array[] = [];
    cap.onFrame((f) => frames.push(f));

    emit(new Float32Array([0.5, -0.5]));
    expect(frames).toHaveLength(1);
    expect(frames[0]).toHaveLength(4);

    cap.setMuted(true);
    emit(new Float32Array([0.5, 0.5]));
    expect(frames).toHaveLength(1);

    cap.setMuted(false);
    emit(new Float32Array([0.25]));
    expect(frames).toHaveLength(2);

    await cap.stop();
    emit(new Float32Array([0.5]));
    expect(frames).toHaveLength(2);
  });

  it("stops mic tracks and closes context", async () => {
    const cap = new MicCaptureImpl();
    const { deps, stream } = fakeDeps();
    await cap.start(deps);
    await cap.stop();
    expect(stream.getTracks()[0]!.stop).toHaveBeenCalled();
  });

  it("rejects a context at the wrong sample rate", async () => {
    const { deps, stream } = fakeDeps();
    const wrong = {
      ...deps.audioContextFactory(),
      sampleRate: 48_000,
    };
    deps.audioContextFactory = () => wrong;
    const cap = new MicCaptureImpl();
    await expect(cap.start(deps)).rejects.toThrow("capture context rate");
    expect(stream.getTracks()[0]!.stop).toHaveBeenCalled();
  });
});
