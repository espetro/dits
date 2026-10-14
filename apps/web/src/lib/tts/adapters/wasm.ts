import { StreamingRPCChannel } from "kkrpc/streaming";
import { workerTransport } from "kkrpc/worker";

import type { KittenTtsApi } from "@di/voice-engines/kitten";
import { DiError } from "../../errors";
import { pushVoiceHealth } from "../../voice/health";
import { readVoiceModelFile } from "../../voice/models";
import {
  RPC_TIMEOUT_MS,
  VAD_ASSETS_BASE,
  effectiveManifest,
  healthError,
  workerErrorMessage,
} from "../../voice/wasm-shared";
import type { WasmEngineDeps, WorkerLike } from "../../voice/wasm-shared";
import type { TtsEngine } from "../port";

export type { WasmEngineDeps, WorkerLike } from "../../voice/wasm-shared";

export class WasmTtsNotReadyError extends DiError {
  constructor() {
    super("models.ttsEngine", undefined, "wasm tts engine not available");
  }
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
          const message = workerErrorMessage(ev);
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
