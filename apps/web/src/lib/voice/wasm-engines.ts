import type { SttEngine, SttEngineCallbacks, TtsEngine } from "./engines";
import { readVoiceModelFile } from "./models";
import type { VoiceModelStorage } from "./models";
import type { KittenInMsg, KittenOutMsg, KittenSpeakMsg } from "./kitten/kitten-worker";
import type { SttInMsg, SttOutMsg } from "./sherpa/stt-worker";

/**
 * On-device engines (phase c/d). Each lazily spawns a dedicated Worker that
 * owns its runtime (ort wasm for tts, sherpa-onnx for stt); model bytes come
 * from the manifest cache via readVoiceModelFile.
 */

export class WasmSttNotReadyError extends Error {
  constructor() {
    super("wasm stt engine not available");
  }
}

export class WasmTtsNotReadyError extends Error {
  constructor() {
    super("wasm tts engine not available");
  }
}

export interface WasmEngineDeps {
  /** test seam: fake worker */
  workerFactory?: () => WorkerLike;
  /** test seam: in-memory model cache */
  storage?: VoiceModelStorage;
  /** ort wasm asset root (default /vad/, the vendored build) */
  wasmBase?: string;
}

/** Structural subset of Worker the engines need. */
export interface WorkerLike {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: AbstractWorker["onerror"];
  terminate(): void;
}

const VAD_ASSETS_BASE = (import.meta.env.VITE_VAD_ASSETS_BASE as string | undefined) ?? "/vad/";

/** KittenTTS over onnxruntime-web wasm in a dedicated worker. */
export class WasmTts implements TtsEngine {
  private worker: WorkerLike | null = null;
  private readyPromise: Promise<void> | null = null;
  private seq = 0;
  private readonly pending = new Map<
    number,
    { resolve: (pcm: Float32Array) => void; reject: (err: Error) => void }
  >();

  constructor(private readonly deps: WasmEngineDeps = {}) {}

  /** resolves when the cached tts model files are verified present */
  async prepare(): Promise<void> {
    const model = await readVoiceModelFile("tts", "tts/model.onnx", undefined, this.deps.storage);
    const voices = await readVoiceModelFile("tts", "tts/voices.npz", undefined, this.deps.storage);
    if (!model || !voices) throw new WasmTtsNotReadyError();
  }

  private boot(): Promise<void> {
    this.readyPromise ??= (async () => {
      const model = await readVoiceModelFile("tts", "tts/model.onnx", undefined, this.deps.storage);
      const voices = await readVoiceModelFile(
        "tts",
        "tts/voices.npz",
        undefined,
        this.deps.storage,
      );
      if (!model || !voices) throw new WasmTtsNotReadyError();
      const worker =
        this.deps.workerFactory?.() ??
        new Worker(new URL("./kitten/kitten-worker.ts", import.meta.url), {
          type: "module",
        });
      this.worker = worker;
      const ready = new Promise<void>((resolve, reject) => {
        worker.onmessage = (ev) => {
          const msg = ev.data as KittenOutMsg;
          if (msg.type === "ready") return resolve();
          if (msg.type === "error" && msg.id === null) return reject(new Error(msg.message));
          if (msg.type === "pcm") {
            const entry = this.pending.get(msg.id);
            if (entry) {
              this.pending.delete(msg.id);
              entry.resolve(msg.pcm);
            }
          } else if (msg.type === "error" && msg.id !== null) {
            const entry = this.pending.get(msg.id);
            if (entry) {
              this.pending.delete(msg.id);
              entry.reject(new Error(msg.message));
            }
          }
        };
        worker.onerror = (ev) => reject(new Error(`tts worker failed: ${String(ev)}`));
      });
      const init: KittenInMsg = {
        type: "init",
        model,
        voices,
        wasmBase: this.deps.wasmBase ?? VAD_ASSETS_BASE,
      };
      worker.postMessage(init, [model, voices]);
      await ready;
    })().catch((err: unknown) => {
      // a failed boot must not poison future speak() calls
      this.readyPromise = null;
      this.worker?.terminate();
      this.worker = null;
      throw err;
    });
    return this.readyPromise;
  }

  async speak(sentence: string): Promise<Float32Array> {
    await this.boot();
    const worker = this.worker;
    if (!worker) throw new WasmTtsNotReadyError();
    const id = this.seq++;
    const msg: KittenSpeakMsg = { type: "speak", id, text: sentence };
    const promise = new Promise<Float32Array>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    worker.postMessage(msg);
    return promise;
  }

  dispose(): void {
    this.readyPromise = null;
    this.worker?.terminate();
    this.worker = null;
    for (const entry of this.pending.values()) entry.reject(new Error("tts engine disposed"));
    this.pending.clear();
  }
}

/**
 * sherpa-onnx streaming zipformer (int8 ctc) stt in a dedicated worker.
 * Silero VAD on the main thread decides utterance boundaries — feed() is
 * fire-and-forget, flush() emits onFinal for the current utterance.
 */
export class WasmStt implements SttEngine {
  private worker: WorkerLike | null = null;
  private readyPromise: Promise<void> | null = null;
  private cb: SttEngineCallbacks | null = null;
  /** frames arriving during worker boot are buffered, then replayed */
  private preboot: Float32Array[] = [];

  constructor(private readonly deps: WasmEngineDeps = {}) {}

  /** resolves when the cached stt model files are verified present */
  async prepare(): Promise<void> {
    const model = await readVoiceModelFile("stt", "stt/model.onnx", undefined, this.deps.storage);
    const tokens = await readVoiceModelFile("stt", "stt/tokens.txt", undefined, this.deps.storage);
    if (!model || !tokens) throw new WasmSttNotReadyError();
  }

  async start(opts: SttEngineCallbacks): Promise<void> {
    this.cb = opts;
    await this.boot();
  }

  private boot(): Promise<void> {
    this.readyPromise ??= (async () => {
      const model = await readVoiceModelFile("stt", "stt/model.onnx", undefined, this.deps.storage);
      const tokens = await readVoiceModelFile(
        "stt",
        "stt/tokens.txt",
        undefined,
        this.deps.storage,
      );
      if (!model || !tokens) throw new WasmSttNotReadyError();
      const worker =
        this.deps.workerFactory?.() ??
        new Worker(new URL("./sherpa/stt-worker.ts", import.meta.url), { type: "module" });
      this.worker = worker;
      const ready = new Promise<void>((resolve, reject) => {
        worker.onmessage = (ev) => {
          const msg = ev.data as SttOutMsg;
          if (msg.type === "ready") return resolve();
          if (msg.type === "error") return reject(new Error(msg.message));
          if (msg.type === "partial") this.cb?.onInterim(msg.text);
          if (msg.type === "final") {
            if (msg.text.trim()) this.cb?.onFinal(msg.text);
          }
        };
        worker.onerror = (ev) => reject(new Error(`stt worker failed: ${String(ev)}`));
      });
      const init: SttInMsg = { type: "init", model, tokens };
      worker.postMessage(init, [model, tokens]);
      await ready;
      for (const f of this.preboot.splice(0)) worker.postMessage({ type: "feed", samples: f });
    })().catch((err: unknown) => {
      // a failed boot must not poison future start() calls
      this.readyPromise = null;
      this.worker?.terminate();
      this.worker = null;
      throw err;
    });
    return this.readyPromise;
  }

  feed(frame: Float32Array): void {
    const worker = this.worker;
    if (!worker) {
      if (this.readyPromise && this.preboot.length < 100) this.preboot.push(frame);
      return;
    }
    worker.postMessage({ type: "feed", samples: frame });
  }

  /** utterance end (vad speech-end): drain the stream and emit onFinal */
  async flush(): Promise<void> {
    await this.boot();
    this.worker?.postMessage({ type: "flush" });
  }

  async stop(): Promise<void> {
    this.readyPromise = null;
    this.cb = null;
    this.preboot = [];
    this.worker?.terminate();
    this.worker = null;
  }
}
