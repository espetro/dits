import { CAPTURE_SAMPLE_RATE } from "@di/shared/voice";

/** ~100ms of mono 16k Float32 samples per worklet message. */
const FRAME_SAMPLES = Math.floor(CAPTURE_SAMPLE_RATE * 0.1);

/**
 * AudioWorklet processor: collects 128-sample render quanta, flushes a
 * Float32Array to the main thread every FRAME_SAMPLES samples. Kept as a
 * string so no separate worklet file/bundle step is needed; loaded from a
 * blob URL.
 */
export const CAPTURE_WORKLET_CODE = `
class DiCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Float32Array(${FRAME_SAMPLES});
    this._n = 0;
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this._buf[this._n++] = ch[i];
      if (this._n === this._buf.length) {
        this.port.postMessage(this._buf.slice(0));
        this._n = 0;
      }
    }
    return true;
  }
}
registerProcessor("di-capture", DiCaptureProcessor);
`;

/** Pure conversion: Float32 samples in [-1,1] to PCM16 little-endian bytes. */
export function floatToPcm16(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer, 0);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(i * 2, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
  }
  return out;
}

export interface AudioContextLike {
  readonly sampleRate: number;
  readonly audioWorklet: { addModule(url: string): Promise<void> };
  createMediaStreamSource(stream: unknown): {
    connect(node: unknown): void;
    disconnect(): void;
  };
  createAudioWorkletNode(
    name: string,
    opts?: unknown,
  ): {
    port: { onmessage: ((ev: { data: unknown }) => void) | null };
    connect(dest?: unknown): void;
    disconnect(): void;
  };
  close(): Promise<void>;
}

export interface MicCapture {
  onFrame(cb: (pcm16: Uint8Array) => void): void;
  /** optional loudness tap (rms per worklet frame) for UI visualizers */
  onLevel?(cb: ((rms: number) => void) | null): void;
  setMuted(muted: boolean): void;
  stop(): Promise<void>;
}

export interface CaptureDeps {
  /** fetch-free context injection for tests */
  audioContextFactory?: () => AudioContextLike;
  /** getUserMedia substitute for tests */
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<unknown>;
  /** createObjectURL for the worklet blob (default URL.createObjectURL) */
  createObjectURL?: (blob: unknown) => string;
}

/**
 * Mic capture: AudioContext at 16k (the browser resamples the mic input to
 * the context rate, so 16k comes out directly), AudioWorklet batching to
 * ~100ms frames, Float32 to PCM16LE in the main thread.
 *
 * Mute strategy: keep the mic track enabled but drop frames in the main
 * thread. Disabling the track would renegotiate some devices and Chrome can
 * then re-prompt for permission on re-enable on some setups; dropping frames
 * is silent and instantly reversible. (VAD still sees silence-deprived input
 * which is fine: muted speech must not be sent.)
 */
export class MicCaptureImpl implements MicCapture {
  private frameCb: ((pcm16: Uint8Array) => void) | null = null;
  private levelCb: ((rms: number) => void) | null = null;
  private muted = false;
  private ctx: AudioContextLike | null = null;
  private source: { disconnect(): void } | null = null;
  private node: {
    port: { onmessage: ((ev: { data: unknown }) => void) | null };
    disconnect(): void;
  } | null = null;
  private stream: { getTracks(): { stop(): void }[] } | null = null;

  async start(deps: CaptureDeps = {}): Promise<void> {
    const gum =
      deps.getUserMedia ?? ((c: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(c));
    const stream = (await gum({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })) as { getTracks(): { stop(): void }[] };
    this.stream = stream;

    const ACtor = deps.audioContextFactory as (() => AudioContextLike) | undefined;
    const ctx =
      ACtor?.() ??
      new (globalThis.AudioContext as unknown as new (o?: {
        sampleRate: number;
      }) => AudioContextLike)({
        sampleRate: CAPTURE_SAMPLE_RATE,
      });
    if (ctx.sampleRate !== CAPTURE_SAMPLE_RATE) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error(`capture context rate ${ctx.sampleRate} != ${CAPTURE_SAMPLE_RATE}`);
    }
    this.ctx = ctx;

    const createObjectURL =
      deps.createObjectURL ?? ((b: unknown) => URL.createObjectURL(b as Blob));
    const url = createObjectURL(
      new Blob([CAPTURE_WORKLET_CODE], { type: "application/javascript" }),
    );
    await ctx.audioWorklet.addModule(url);

    const source = ctx.createMediaStreamSource(stream);
    const node = ctx.createAudioWorkletNode("di-capture");
    node.port.onmessage = (ev: { data: unknown }) => {
      const samples = ev.data as Float32Array;
      if (!(samples instanceof Float32Array)) return;
      // loudness tap for the voice orb (attack envelope, see lib/voice/levels)
      let sum = 0;
      const n = samples.length;
      for (let i = 0; i < n; i++) {
        const s = samples[i];
        if (s !== undefined) sum += s * s;
      }
      const count = n > 0 ? n : 1;
      this.levelCb?.(Math.sqrt(sum / count));
      if (this.muted || !this.frameCb) return;
      this.frameCb(floatToPcm16(samples));
    };
    source.connect(node);
    this.source = source;
    this.node = node;
  }

  onFrame(cb: (pcm16: Uint8Array) => void): void {
    this.frameCb = cb;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  async stop(): Promise<void> {
    this.frameCb = null;
    this.node?.disconnect();
    this.node = null;
    this.source?.disconnect();
    this.source = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    await this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}

/** Convenience factory: builds and starts a capture in one call. */
export async function startCapture(deps: CaptureDeps = {}): Promise<MicCapture> {
  const cap = new MicCaptureImpl();
  await cap.start(deps);
  return cap;
}
