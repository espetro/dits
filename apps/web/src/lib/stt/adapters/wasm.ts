import { StreamingRPCChannel } from "kkrpc/streaming";
import { workerTransport } from "kkrpc/worker";

import { DiError } from "../../errors";
import { pushVoiceHealth } from "../../voice/health";
import { readVoiceModelFile } from "../../voice/models";
import {
  RPC_TIMEOUT_MS,
  effectiveManifest,
  healthError,
  workerErrorMessage,
} from "../../voice/wasm-shared";
import type { WasmEngineDeps, WorkerLike } from "../../voice/wasm-shared";
import type { SttEngine, SttEngineCallbacks } from "../port";
import type { SherpaSttApi } from "./sherpa/stt-api";

export type { WasmEngineDeps, WorkerLike } from "../../voice/wasm-shared";

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

export class WasmSttNotReadyError extends DiError {
  constructor() {
    super("models.sttEngine", undefined, "wasm stt engine not available");
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
          const message = workerErrorMessage(ev);
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
