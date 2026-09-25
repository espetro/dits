import { describe, expect, it } from "vitest";
import { createPcmPlayer, pcm16ToFloat } from "./pcm-player";
import type { AudioBufferLike, AudioBufferSourceNodeLike, AudioContextLike } from "./pcm-player";

function fakeCtx() {
  let now = 0;
  const started: { at: number; samples: number; rate: number }[] = [];
  const ctx: AudioContextLike = {
    sampleRate: 24_000,
    get currentTime() {
      return now;
    },
    destination: {},
    createBuffer(channels, length, sampleRate) {
      const buf: AudioBufferLike = {
        duration: length / sampleRate,
        getChannelData: () => new Float32Array(length),
      };
      return buf;
    },
    createBufferSource() {
      const node: AudioBufferSourceNodeLike = {
        buffer: null,
        onended: null,
        connect: () => node,
        start(when = 0) {
          started.push({
            at: when,
            samples: node.buffer!.getChannelData(0).length,
            rate: ctx.sampleRate,
          });
        },
        stop: () => undefined,
        disconnect: () => undefined,
      };
      return node;
    },
    async close() {
      return;
    },
  };
  return { ctx, started, tick: (t: number) => (now = t) };
}

function frame(millis: number, rate = 24_000): Uint8Array {
  const n = Math.floor((millis / 1000) * rate);
  const bytes = new Uint8Array(n * 2);
  for (let i = 0; i < n; i++) bytes[i * 2] = 1; // small positive sample
  return bytes;
}

describe("pcm16ToFloat", () => {
  it("decodes LE pcm16 into [-1,1] floats", () => {
    const bytes = new Uint8Array([0x00, 0x40, 0x00, 0xc0, 0x01, 0x00]);
    expect([...pcm16ToFloat(bytes)]).toEqual([0.5, -0.5, 1 / 32768]);
  });
});

describe("createPcmPlayer", () => {
  it("schedules chunks back-to-back from the current playhead", () => {
    const { ctx, started } = fakeCtx();
    const player = createPcmPlayer({ createContext: () => ctx });
    player.write(frame(100));
    player.write(frame(200));
    player.write(frame(50));
    expect(started.map((s) => s.at.toFixed(2))).toEqual(["0.00", "0.10", "0.30"]);
    expect(player.playing).toBe(true);
  });

  it("schedules from ctx.currentTime when audio lapses", () => {
    const { ctx, started, tick } = fakeCtx();
    const player = createPcmPlayer({ createContext: () => ctx });
    player.write(frame(100));
    tick(5); // wall clock jumped past the first chunk
    player.write(frame(100));
    expect(started.map((s) => s.at.toFixed(1))).toEqual(["0.0", "5.0"]);
  });

  it("stop clears sources and fires no drain mid-stream, resets playhead", () => {
    const { ctx, started, tick } = fakeCtx();
    const player = createPcmPlayer({ createContext: () => ctx });
    player.write(frame(100));
    player.write(frame(100));
    player.stop();
    expect(player.playing).toBe(false);
    const countAfterStop = started.length;
    tick(1);
    player.write(frame(100));
    expect(started.length).toBe(countAfterStop + 1);
    expect(started.at(-1)!.at.toFixed(1)).toBe("1.0");
  });

  it("fires drained when the last active source ends", () => {
    const { ctx } = fakeCtx();
    const player = createPcmPlayer({ createContext: () => ctx });
    let drained = 0;
    player.onDrained(() => drained++);
    // fake sources never fire onended; simulate via the nodes we handed out
    const sources: AudioBufferSourceNodeLike[] = [];
    const capturingCtx: AudioContextLike = {
      ...ctx,
      createBufferSource() {
        const n = ctx.createBufferSource();
        sources.push(n);
        return n;
      },
    };
    const p2 = createPcmPlayer({ createContext: () => capturingCtx });
    let d2 = 0;
    p2.onDrained(() => d2++);
    p2.write(frame(50));
    p2.write(frame(50));
    expect(d2).toBe(0);
    sources[0]!.onended?.call(sources[0]!, undefined);
    expect(d2).toBe(0);
    sources[1]!.onended?.call(sources[1]!, undefined);
    expect(d2).toBe(1);
    expect(p2.playing).toBe(false);
    expect(drained).toBe(0);
  });
});
