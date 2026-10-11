/**
 * Builtin voice engines: sherpa-onnx STT + KittenTTS running in Bun workers
 * over kkrpc, satisfying the same ports the remote HTTP adapters do.
 * Workers boot lazily on first use so text-only sessions pay nothing; model
 * bytes are pulled sha256-verified into files.data_dir/models on first
 * builtin use (or ahead of time by the cli/startup warm path).
 */
import { readFile } from "node:fs/promises";
import { StreamingRPCChannel } from "kkrpc/streaming";
import { workerTransport } from "kkrpc/worker";

import type { BuiltinSttApi } from "./stt-worker.ts";
import type { KittenTtsApi } from "@di/voice-engines/kitten";
import { resolveVoiceRuntime } from "./runtime.ts";
import type { VoiceRuntime } from "./runtime.ts";
import { builtinModelPath, ensureBuiltinModels } from "./models.ts";

/** Boot handshake ceiling — model pull is separate, this is wasm+model load only. */
const RPC_TIMEOUT_MS = 30_000;

export interface BuiltinEngineDeps {
  dataDir: string;
  /** test seam: override runtime resolution + worker spawn */
  runtime?: VoiceRuntime | null;
  workerFactory?: (path: string) => Worker;
  fetchImpl?: typeof fetch;
}

interface BootedWorker<TApi> {
  api: TApi;
  worker: Worker;
}

function pcm16ToFloat32(pcm: Uint8Array): Float32Array {
  const view = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
  const out = new Float32Array(view.length);
  for (let i = 0; i < view.length; i++) out[i] = view[i]! / 32768;
  return out;
}

function float32ToPcm16(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(i * 2, Math.round(s * 32767), true);
  }
  return out;
}

/** Concatenate an async pcm chunk stream into one Float32Array. */
async function collectChunks(stream: AsyncIterable<Float32Array>): Promise<Float32Array> {
  const parts: Float32Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    parts.push(chunk);
    total += chunk.length;
  }
  const out = new Float32Array(total);
  let off = 0;
  for (const part of parts) {
    out.set(part, off);
    off += part.length;
  }
  return out;
}

/**
 * Spawn a worker + rpc channel. A worker-side parse/init crash never
 * reaches the rpc channel, so init is raced against worker.onerror.
 * Failed boots tear the worker down so a retry starts clean.
 */
async function bootWorker<TApi extends object>(
  deps: BuiltinEngineDeps,
  workerPath: string,
  init: (api: TApi) => Promise<void>,
): Promise<BootedWorker<TApi>> {
  const worker = deps.workerFactory?.(workerPath) ?? new Worker(workerPath);
  try {
    let rejectBoot: ((err: Error) => void) | null = null;
    const bootCrash = new Promise<never>((_resolve, reject) => {
      rejectBoot = reject;
    });
    worker.onerror = (ev) => {
      const message =
        typeof ev === "object" && ev !== null && "message" in ev ? String(ev.message) : String(ev);
      rejectBoot?.(new Error(`voice worker error before ready: ${message}`));
    };
    const api = new StreamingRPCChannel<object, TApi>(workerTransport(worker), {
      timeout: RPC_TIMEOUT_MS,
    }).getAPI();
    await Promise.race([init(api), bootCrash]);
    return { api, worker };
  } catch (err) {
    worker.terminate();
    throw err;
  }
}

/**
 * sherpa-onnx zipformer STT in a Bun worker. Streaming-native: feed()
 * forwards 16k frames, finish() drains and resolves the transcript. Also
 * satisfies the buffered transcribePcm port (feed + finish).
 */
export class BuiltinSherpaStt {
  readonly label = "di_sherpa_stt";
  get model(): string {
    return "sherpa-zipformer2-ctc-small";
  }
  get provider(): string {
    return "di.sherpa";
  }
  private booted: Promise<BootedWorker<BuiltinSttApi>> | undefined;

  constructor(private deps: BuiltinEngineDeps) {}

  private boot(): Promise<BuiltinSttApi> {
    this.booted ??= (async () => {
      const runtime = this.deps.runtime ?? resolveVoiceRuntime();
      if (!runtime) throw new Error("builtin voice runtime not found (vendor/voice missing)");
      await ensureBuiltinModels(this.deps.dataDir, {
        modelIds: ["stt"],
        fetchImpl: this.deps.fetchImpl,
      });
      return bootWorker<BuiltinSttApi>(this.deps, runtime.sttWorker, (api) =>
        api.init({
          modelPath: builtinModelPath(this.deps.dataDir, "stt/model.onnx"),
          tokensPath: builtinModelPath(this.deps.dataDir, "stt/tokens.txt"),
        }),
      );
    })().then(
      (b) => b,
      (err) => {
        // a failed boot must not poison later feeds
        this.booted = undefined;
        throw err;
      },
    );
    return this.booted.then((b) => b.api);
  }

  async feed(pcm: Uint8Array, opts?: { signal?: AbortSignal }): Promise<void> {
    if (opts?.signal?.aborted || pcm.byteLength === 0) return;
    const api = await this.boot();
    await api.feed(pcm16ToFloat32(pcm));
  }

  async finish(opts?: { signal?: AbortSignal }): Promise<string> {
    if (opts?.signal?.aborted) return "";
    const api = await this.boot();
    return api.flush();
  }

  async transcribePcm(pcm: Uint8Array, opts?: { signal?: AbortSignal }): Promise<string> {
    await this.feed(pcm, opts);
    return this.finish(opts);
  }

  /** Kill the worker; the loop calls this on session close. */
  terminate(): void {
    void this.booted?.then((b) => b.worker.terminate()).catch(() => {});
    this.booted = undefined;
  }
}

/** KittenTTS in a Bun worker; speak() chunks are collected into one pcm16 buffer. */
export class BuiltinKittenTts {
  readonly label = "di_kitten_tts";
  get model(): string {
    return "kitten-tts-nano-0.1";
  }
  get provider(): string {
    return "di.kitten";
  }
  private booted: Promise<BootedWorker<KittenTtsApi>> | undefined;

  constructor(private deps: BuiltinEngineDeps) {}

  private boot(): Promise<KittenTtsApi> {
    this.booted ??= (async () => {
      const runtime = this.deps.runtime ?? resolveVoiceRuntime();
      if (!runtime) throw new Error("builtin voice runtime not found (vendor/voice missing)");
      await ensureBuiltinModels(this.deps.dataDir, {
        modelIds: ["tts"],
        fetchImpl: this.deps.fetchImpl,
      });
      const [model, voices] = await Promise.all([
        readFile(builtinModelPath(this.deps.dataDir, "tts/model.onnx")),
        readFile(builtinModelPath(this.deps.dataDir, "tts/voices.npz")),
      ]);
      return bootWorker<KittenTtsApi>(this.deps, runtime.ttsWorker, (api) =>
        api.init({
          model: model.buffer.slice(
            model.byteOffset,
            model.byteOffset + model.byteLength,
          ) as ArrayBuffer,
          voices: voices.buffer.slice(
            voices.byteOffset,
            voices.byteOffset + voices.byteLength,
          ) as ArrayBuffer,
          wasmBase: `${runtime.ortDir}/`,
        }),
      );
    })().then(
      (b) => b,
      (err) => {
        this.booted = undefined;
        throw err;
      },
    );
    return this.booted.then((b) => b.api);
  }

  async synthesizeToPcm(text: string, opts?: { signal?: AbortSignal }): Promise<Uint8Array> {
    if (opts?.signal?.aborted) return new Uint8Array(0);
    const api = await this.boot();
    const pcm = await collectChunks(api.speak(text));
    return float32ToPcm16(pcm);
  }

  /** Kill the worker; the loop calls this on session close. */
  terminate(): void {
    void this.booted?.then((b) => b.worker.terminate()).catch(() => {});
    this.booted = undefined;
  }
}
