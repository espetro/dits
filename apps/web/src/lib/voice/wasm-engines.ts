import type { SttEngine, SttEngineCallbacks, TtsEngine } from "./engines";
import { readVoiceModelFile } from "./models";
import type { VoiceModelStorage } from "./models";
import type { KittenInMsg, KittenOutMsg, KittenSpeakMsg } from "./kitten/kitten-worker";

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
 * sherpa-onnx streaming zipformer stt — lands in phase d; the stub keeps
 * the interface + cached-bytes check so an engine never half-exists.
 */
export class WasmStt implements SttEngine {
  constructor(private readonly deps: WasmEngineDeps = {}) {}

  async prepare(): Promise<void> {
    const model = await readVoiceModelFile("stt", "stt/model.onnx", undefined, this.deps.storage);
    const tokens = await readVoiceModelFile("stt", "stt/tokens.txt", undefined, this.deps.storage);
    if (!model || !tokens) throw new WasmSttNotReadyError();
  }

  async start(_opts: SttEngineCallbacks): Promise<void> {
    await this.prepare();
    throw new WasmSttNotReadyError();
  }

  feed(_frame: Float32Array): void {
    // stub: the sherpa-onnx worker lands in phase d
  }

  async stop(): Promise<void> {}
}
