import { envNum } from "../env";
import { DEFAULT_VOICE_MODEL_MANIFEST, loadVoiceModelManifest } from "./models";
import type { VoiceModelStorage } from "./models";
import type { VoiceModelManifest } from "@di/shared";

/**
 * Helpers shared by the on-device wasm engines (lib/tts/adapters/wasm.ts,
 * lib/stt/adapters/wasm.ts). Each engine lazily spawns a dedicated Worker
 * that owns its runtime (ort wasm for tts, sherpa-onnx for stt); model bytes
 * come from the manifest cache via readVoiceModelFile. The wire protocol is
 * kkrpc: init() doubles as the ready handshake (rejections carry the worker
 * error), tts speak() is a remote async iterable (chunked pcm + iterator
 * cancel), stt partials/finals arrive as kkrpc callbacks.
 */

/** The manifest the downloader wrote with, override-aware, baked fallback. */
export async function effectiveManifest(): Promise<VoiceModelManifest> {
  return loadVoiceModelManifest().catch(() => DEFAULT_VOICE_MODEL_MANIFEST);
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

export const VAD_ASSETS_BASE =
  (import.meta.env.VITE_VAD_ASSETS_BASE as string | undefined) ?? "/vad/";

/** wasm compile + model parse on slow machines outlasts the 30s default */
export const RPC_TIMEOUT_MS = envNum("VITE_VOICE_RPC_TIMEOUT_MS", 120_000);

export function healthError(err: unknown): string {
  return String(err instanceof Error ? err.message : err);
}

/** Worker crash message for health logging / boot rejection. */
export function workerErrorMessage(ev: unknown): string {
  return typeof ev === "object" && ev !== null && "message" in ev
    ? String((ev as { message: unknown }).message)
    : String(ev);
}
