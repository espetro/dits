import { StreamingRPCChannel } from "kkrpc/streaming";
import { workerTransport } from "kkrpc/worker";

import type { SttEngine, SttEngineCallbacks, TtsEngine } from "./engines";
import { DEFAULT_VOICE_MODEL_MANIFEST, loadVoiceModelManifest, readVoiceModelFile } from "./models";
import type { VoiceModelStorage } from "./models";
import type { VoiceModelManifest } from "@di/shared";
import { DiError } from "../errors";
import type { KittenTtsApi } from "./kitten/kitten-api";
import type { SherpaSttApi } from "./sherpa/stt-api";
import { pushVoiceHealth } from "./health";
import { envNum } from "../env";

// vendored sherpa-onnx browser build under public/sherpa/ (apache-2.0,
// regenerated via scripts/repack-sherpa-stt.ts). the npm package only
// ships the nodejs glue, which can never run in a browser worker.
const SHERPA_BASE = (import.meta.env.VITE_SHERPA_ASSETS_BASE as string | undefined) ?? "/sherpa";
const sherpaAssets = {
  glueUrl: `${SHERPA_BASE}/sherpa-onnx-wasm-main-asr.js`,
  asrUrl: `${SHERPA_BASE}/sherpa-onnx-asr.js`,
  wasmUrl: `${SHERPA_BASE}/sherpa-onnx-wasm-main-asr.wasm`,
  dataUrl: `${SHERPA_BASE}/sherpa-onnx-wasm-main-asr.data`,
};

/**
 * On-device engines (phase c/d). Each lazily spawns a dedicated Worker that
 * owns its runtime (ort wasm for tts, sherpa-onnx for stt); model bytes come
 * from the manifest cache via readVoiceModelFile. The wire protocol is kkrpc:
 * init() doubles as the ready handshake (rejections carry the worker error),
 * tts speak() is a remote async iterable (chunked pcm + iterator cancel),
 * stt partials/finals arrive as kkrpc callbacks.
 */

/** The manifest the downloader wrote with — override-aware, baked fallback. */
async function effectiveManifest(): Promise<VoiceModelManifest> {
  return loadVoiceModelManifest().catch(() => DEFAULT_VOICE_MODEL_MANIFEST);
}

export class WasmSttNotReadyError extends DiError {
  constructor() {
    super("models.sttEngine", undefined, "wasm stt engine not available");
  }
}

export class WasmTtsNotReadyError extends DiError {
  constructor() {
    super("models.ttsEngine", undefined, "wasm tts engine not available");
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

/**
 * Structural subset of Worker the engines need (postMessage + message
 * listeners feed the kkrpc transport; onerror reports worker crashes).
 */
export interface WorkerLike {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (ev: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (ev: MessageEvent) => void): void;
  onerror: AbstractWorker["onerror"];
  terminate(): void;
}

const VAD_ASSETS_BASE = (import.meta.env.VITE_VAD_ASSETS_BASE as string | undefined) ?? "/vad/";

/** wasm compile + model parse on slow machines outlasts the 30s default */
const RPC_TIMEOUT_MS = envNum("VITE_VOICE_RPC_TIMEOUT_MS", 120_000);

function healthError(err: unknown): string {
  return String(err instanceof Error ? err.message : err);
}

/** KittenTTS over onnxruntime-web wasm in a dedicated worker. */
export class WasmTts implements TtsEngine {
  private worker: WorkerLike | null = null;
  private channel: StreamingRPCChannel<object, KittenTtsApi> | null = null;
  private api: KittenTtsApi | null = null;
  private readyPromise: Promise<void> | null = null;
  private disposed = false;
  /** in-flight remote speak iterators: cancelPending() returns them */
  private readonly activeSpeaks = new Set<AsyncIterator<Float32Array>>();

  constructor(private readonly deps: WasmEngineDeps = {}) {}

  /** resolves when the cached tts model files are verified present */
  async prepare(): Promise<void> {
    const manifest = await effectiveManifest();
    const [model, voices] = await Promise.all([
      readVoiceModelFile("tts", "tts/model.onnx", manifest, this.deps.storage),
      readVoiceModelFile("tts", "tts/voices.npz", manifest, this.deps.storage),
    ]);
    if (!model || !voices) throw new WasmTtsNotReadyError();
  }

  private boot(): Promise<void> {
    this.readyPromise ??= (async () => {
      const startedAt = Date.now();
      try {
        const manifest = await effectiveManifest();
        const [model, voices] = await Promise.all([
          readVoiceModelFile("tts", "tts/model.onnx", manifest, this.deps.storage),
          readVoiceModelFile("tts", "tts/voices.npz", manifest, this.deps.storage),
        ]);
        if (!model || !voices) throw new WasmTtsNotReadyError();
        const worker =
          this.deps.workerFactory?.() ??
          new Worker(new URL("./kitten/kitten-worker.ts", import.meta.url), {
            type: "module",
          });
        this.worker = worker;
        // a syntax/parse error in the worker script never reaches the rpc
        // channel — reject boot on worker.onerror so we fail fast instead
        // of hanging until the rpc timeout
        let rejectBoot: ((err: Error) => void) | null = null;
        const bootCrash = new Promise<never>((_resolve, reject) => {
          rejectBoot = reject;
        });
        worker.onerror = (ev) => {
          const message =
            typeof ev === "object" && ev !== null && "message" in ev
              ? String(ev.message)
              : String(ev);
          pushVoiceHealth({
            kind: "worker.error",
            ok: false,
            detail: `tts: ${message}`,
          });
          rejectBoot?.(
            new DiError("models.ttsWorker", undefined, `tts worker error before ready: ${message}`),
          );
        };
        const channel = new StreamingRPCChannel<object, KittenTtsApi>(
          workerTransport(worker as unknown as Worker),
          { timeout: RPC_TIMEOUT_MS },
        );
        this.channel = channel;
        const api = channel.getAPI();
        // init doubles as the ready handshake; a worker-side throw rejects here
        await Promise.race([
          api.init({
            model,
            voices,
            wasmBase: this.deps.wasmBase ?? VAD_ASSETS_BASE,
          }),
          bootCrash,
        ]);
        rejectBoot = null;
        this.api = api;
      } catch (err) {
        pushVoiceHealth({
          kind: "engine.boot",
          ok: false,
          ms: Date.now() - startedAt,
          detail: `tts: ${healthError(err)}`,
        });
        throw err;
      }
      pushVoiceHealth({ kind: "engine.boot", ok: true, ms: Date.now() - startedAt, detail: "tts" });
    })().catch((err: unknown) => {
      // a failed boot must not poison future speak() calls
      this.readyPromise = null;
      this.api = null;
      this.channel?.destroy();
      this.channel = null;
      this.worker?.terminate();
      this.worker = null;
      throw err;
    });
    return this.readyPromise;
  }

  async *speak(sentence: string): AsyncIterable<Float32Array> {
    await this.boot();
    const api = this.api;
    if (!api) throw new WasmTtsNotReadyError();
    const startedAt = Date.now();
    const iterator = api.speak(sentence)[Symbol.asyncIterator]();
    this.activeSpeaks.add(iterator);
    let firstChunkMs: number | null = null;
    try {
      for (;;) {
        const { done, value } = await iterator.next();
        if (done) break;
        if (this.disposed) throw new DiError("models.disposed", undefined, "tts engine disposed");
        if (firstChunkMs === null) firstChunkMs = Date.now() - startedAt;
        yield value;
      }
      pushVoiceHealth({
        kind: "tts.speak",
        ok: true,
        ms: Date.now() - startedAt,
        detail: `${sentence.length} chars, first chunk ${firstChunkMs ?? 0}ms`,
      });
    } catch (err) {
      pushVoiceHealth({
        kind: "tts.speak",
        ok: false,
        ms: Date.now() - startedAt,
        detail: healthError(err),
      });
      throw err;
    } finally {
      // propagate consumer abandon into the remote iterator (same cancel path
      // cancelPending uses) so the worker generator's finally frees its slot
      void iterator.return?.(undefined);
      this.activeSpeaks.delete(iterator);
    }
  }

  /**
   * Barge-in: clear() drops queued (not yet started) utterances on the
   * worker; returning the remote iterators stops the current pulls (the
   * worker generator's finally frees its queue slot).
   */
  cancelPending(): void {
    void this.api?.clear().catch(() => undefined);
    for (const iterator of this.activeSpeaks) void iterator.return?.(undefined);
  }

  dispose(): void {
    this.disposed = true;
    this.cancelPending();
    this.readyPromise = null;
    this.api = null;
    this.channel?.destroy();
    this.channel = null;
    this.worker?.terminate();
    this.worker = null;
  }
}

/**
 * sherpa-onnx streaming zipformer (int8 ctc) stt in a dedicated worker.
 * Silero VAD on the main thread decides utterance boundaries — feed() is
 * fire-and-forget, flush() emits onFinal for the current utterance.
 */
export class WasmStt implements SttEngine {
  private worker: WorkerLike | null = null;
  private channel: StreamingRPCChannel<object, SherpaSttApi> | null = null;
  private api: SherpaSttApi | null = null;
  private readyPromise: Promise<void> | null = null;
  private cb: SttEngineCallbacks | null = null;
  /** frames arriving during worker boot are buffered, then replayed */
  private preboot: Float32Array[] = [];
  /** first frame of the current utterance: anchor for first-partial latency */
  private fedAt: number | null = null;
  private partialSent = false;

  constructor(private readonly deps: WasmEngineDeps = {}) {}

  /** resolves when the cached stt model files are verified present */
  async prepare(): Promise<void> {
    const manifest = await effectiveManifest();
    const [model, tokens] = await Promise.all([
      readVoiceModelFile("stt", "stt/model.onnx", manifest, this.deps.storage),
      readVoiceModelFile("stt", "stt/tokens.txt", manifest, this.deps.storage),
    ]);
    if (!model || !tokens) throw new WasmSttNotReadyError();
  }

  async start(opts: SttEngineCallbacks): Promise<void> {
    this.cb = opts;
    await this.boot();
  }

  private boot(): Promise<void> {
    this.readyPromise ??= (async () => {
      const startedAt = Date.now();
      try {
        const manifest = await effectiveManifest();
        const [model, tokens] = await Promise.all([
          readVoiceModelFile("stt", "stt/model.onnx", manifest, this.deps.storage),
          readVoiceModelFile("stt", "stt/tokens.txt", manifest, this.deps.storage),
        ]);
        if (!model || !tokens) throw new WasmSttNotReadyError();
        // classic worker, not module: the sherpa glue loads via importScripts,
        // which module workers do not have.
        const worker =
          this.deps.workerFactory?.() ??
          new Worker(new URL("./sherpa/stt-worker.ts", import.meta.url), { type: "classic" });
        this.worker = worker;
        // a syntax/parse error in the classic worker script (e.g. vite dev
        // serving it transformed) never reaches the rpc channel — reject
        // boot on worker.onerror so we fall back to builtin immediately
        let rejectBoot: ((err: Error) => void) | null = null;
        const bootCrash = new Promise<never>((_resolve, reject) => {
          rejectBoot = reject;
        });
        worker.onerror = (ev) => {
          const message =
            typeof ev === "object" && ev !== null && "message" in ev
              ? String(ev.message)
              : String(ev);
          pushVoiceHealth({
            kind: "worker.error",
            ok: false,
            detail: `stt: ${message}`,
          });
          rejectBoot?.(
            new DiError("models.sttWorker", undefined, `stt worker error before ready: ${message}`),
          );
        };
        const channel = new StreamingRPCChannel<object, SherpaSttApi>(
          workerTransport(worker as unknown as Worker),
          { timeout: RPC_TIMEOUT_MS },
        );
        this.channel = channel;
        const api = channel.getAPI();
        await Promise.race([
          api.init(
            {
              model,
              tokens,
              assets: sherpaAssets,
            },
            (text) => {
              if (text.trim() && this.fedAt !== null && !this.partialSent) {
                pushVoiceHealth({
                  kind: "stt.firstPartial",
                  ok: true,
                  ms: Date.now() - this.fedAt,
                });
                this.partialSent = true;
              }
              this.cb?.onInterim(text);
            },
            (text) => {
              this.fedAt = null;
              this.partialSent = false;
              if (text.trim()) this.cb?.onFinal(text);
            },
          ),
          bootCrash,
        ]);
        rejectBoot = null;
        this.api = api;
        for (const f of this.preboot.splice(0)) {
          void api
            .feed(f)
            .catch((err: unknown) =>
              pushVoiceHealth({ kind: "stt.feed", ok: false, detail: healthError(err) }),
            );
        }
      } catch (err) {
        pushVoiceHealth({
          kind: "engine.boot",
          ok: false,
          ms: Date.now() - startedAt,
          detail: `stt: ${healthError(err)}`,
        });
        throw err;
      }
      pushVoiceHealth({ kind: "engine.boot", ok: true, ms: Date.now() - startedAt, detail: "stt" });
    })().catch((err: unknown) => {
      // a failed boot must not poison future start() calls
      this.readyPromise = null;
      this.api = null;
      this.channel?.destroy();
      this.channel = null;
      this.worker?.terminate();
      this.worker = null;
      throw err;
    });
    return this.readyPromise;
  }

  feed(frame: Float32Array): void {
    this.fedAt ??= Date.now();
    const api = this.api;
    if (!api) {
      if (this.readyPromise && this.preboot.length < 100) this.preboot.push(frame);
      return;
    }
    void api
      .feed(frame)
      .catch((err: unknown) =>
        pushVoiceHealth({ kind: "stt.feed", ok: false, detail: healthError(err) }),
      );
  }

  /** utterance end (vad speech-end): drain the stream and emit onFinal */
  async flush(): Promise<void> {
    await this.boot();
    try {
      await this.api?.flush();
    } catch (err) {
      pushVoiceHealth({ kind: "stt.flush", ok: false, detail: healthError(err) });
      throw err;
    }
  }

  async stop(): Promise<void> {
    this.readyPromise = null;
    this.cb = null;
    this.api = null;
    this.preboot = [];
    this.fedAt = null;
    this.partialSent = false;
    this.channel?.destroy();
    this.channel = null;
    this.worker?.terminate();
    this.worker = null;
  }
}
