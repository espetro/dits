/**
 * VAD gate over @ricky0123/vad-web. Integration approach: MicVAD constructed
 * with startOnLoad: false and a never-called getStream, then fed frames via
 * its public processFrame(Float32Array). That reuses vad-web's own silero
 * model loading (state tensors, thresholds, hysteresis) without its audio
 * graph, so our capture.ts stays the single audio path and we keep the
 * PCM16 bytes for streaming to the server. NonRealTimeVAD.run() only accepts
 * complete audio arrays, so it does not fit streaming.
 *
 * Assets: silero onnx + ort wasm are vendored into apps/web/public/vad/ (committed,
 * no CDN); baseAssetPath/onnxWASMBasePath point there.
 */

export interface VadGate {
  /** Feed one PCM16LE mono 16k chunk; internally re-chunked to silero frames. */
  processFrame(pcm16: Uint8Array): void;
  destroy(): Promise<void>;
}

export interface VadGateOptions {
  onSpeechStart?: () => void;
  onSpeechEnd?: (audio: Float32Array) => void;
  /** base path for silero onnx + ort wasm assets (default /vad/) */
  modelAssetsBase?: string;
  /** test seam: inject a fully custom VAD implementation */
  impl?: VadImpl;
}

/** The subset of vad-web we depend on, as an interface so tests can stub it. */
export interface VadImpl {
  processFrame(frame: Float32Array): Promise<void>;
  destroy(): Promise<void>;
}

const BASE = (import.meta.env.VITE_VAD_ASSETS_BASE as string | undefined) ?? "/vad/";

/** silero legacy frame size at 16k: 1536 samples (~96ms) */
const FRAME_SAMPLES = 1536;

/** Convert PCM16LE bytes to normalized floats appended after a carry buffer. */
export function mergeIntoCarry(carry: Float32Array, pcm16: Uint8Array): Float32Array {
  const n = pcm16.byteLength >> 1;
  const out = new Float32Array(carry.length + n);
  out.set(carry);
  const view = new DataView(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);
  for (let i = 0; i < n; i++) out[carry.length + i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

/**
 * Wraps a VadImpl (default: vad-web MicVAD in manual-feed mode) with
 * byte-to-frame re-chunking and start/end callbacks. processFrame never
 * awaits: model runs are fire-and-forget, matching real-time capture.
 */
export async function createVadGate(opts: VadGateOptions = {}): Promise<VadGate> {
  const assetsBase = (opts.modelAssetsBase ?? BASE).replace(/\/?$/, "/");
  const impl = opts.impl ?? (await createDefaultImpl(assetsBase, opts));

  let carry = new Float32Array(0);

  return {
    processFrame(pcm16: Uint8Array) {
      const samples = mergeIntoCarry(carry, pcm16);
      const frames = Math.floor(samples.length / FRAME_SAMPLES);
      carry = samples.slice(frames * FRAME_SAMPLES);
      for (let f = 0; f < frames; f++) {
        void impl.processFrame(samples.slice(f * FRAME_SAMPLES, (f + 1) * FRAME_SAMPLES));
      }
    },
    async destroy() {
      await impl.destroy();
    },
  };
}

/**
 * Default impl: MicVAD.new with startOnLoad false and a getStream stub that
 * never resolves (start() is never called; only processFrame/destroy are
 * used). ort wasm paths point at the vendored assets. Lazy dynamic import so
 * tests and non-voice routes never load onnxruntime.
 */
async function createDefaultImpl(assetsBase: string, opts: VadGateOptions): Promise<VadImpl> {
  const { MicVAD } = await import("@ricky0123/vad-web");
  const mic = await MicVAD.new({
    model: "legacy",
    baseAssetPath: assetsBase,
    onnxWASMBasePath: assetsBase,
    startOnLoad: false,
    // never called: we never start() the internal audio graph
    getStream: () => new Promise<MediaStream>(() => undefined),
    onSpeechStart: () => opts.onSpeechStart?.(),
    onSpeechEnd: (audio) => opts.onSpeechEnd?.(audio),
  });
  return {
    processFrame: (frame) => mic.processFrame(frame),
    destroy: () => mic.destroy(),
  };
}
