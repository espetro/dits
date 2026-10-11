import {
  collectModelFiles,
  downloadVoiceModelFiles,
  loadVoiceModelManifest as loadManifestCore,
  readVoiceModelFile as readVoiceModelFileCore,
  VoiceModelError,
  voiceModelBytesInstalled as voiceModelBytesInstalledCore,
  voiceModelInstalled as voiceModelInstalledCore,
} from "@di/voice-engines/models";
import type { VoiceModelStorage } from "@di/voice-engines/models";
import { DEFAULT_VOICE_MODEL_MANIFEST, modelFileKey } from "@di/voice-engines/manifest";
import type { VoiceModelManifest } from "@di/shared";
import { $voiceDownload, $voiceModelsInstalled } from "../../stores/voice";
import type { VoiceDownloadState } from "../../stores/voice";
import { DiError, errorCode } from "../errors";

/**
 * Browser-side voice model pipeline glue. The manifest + verify/download
 * core lives in @di/voice-engines (shared with the server's builtin
 * engines); this file owns the runtime overrides (VITE_/localStorage), the
 * CacheStorage/OPFS storage impls, progress stores, and DiError mapping.
 */

const CACHE_NAME = "di-voice-models";
const OPFS_DIR = "voice-models";

export const VOICE_MODELS_BASE = import.meta.env.VITE_VOICE_MODELS_BASE as string | undefined;

/**
 * Runtime asset-root override: `di.voice.models-base` in localStorage wins
 * over the build-time env. Lets deployments (and e2e) point at a mirror
 * without a rebuild; anything else falls through to the baked manifest.
 */
export function resolveVoiceModelsBase(): string | undefined {
  try {
    return localStorage.getItem("di.voice.models-base") ?? VOICE_MODELS_BASE;
  } catch {
    return VOICE_MODELS_BASE;
  }
}

export { DEFAULT_VOICE_MODEL_MANIFEST, modelFileKey };
export type { VoiceModelStorage };

/** Minimal wasm+simd probe (wasm-feature-detect simd bytes). */
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15,
  253, 98, 11,
]);

/** wasm + simd + a usable digest api; the engines' floor requirement. */
export function wasmVoiceSupported(): boolean {
  try {
    return (
      typeof WebAssembly !== "undefined" &&
      WebAssembly.validate(SIMD_PROBE) &&
      typeof crypto !== "undefined" &&
      typeof crypto.subtle?.digest === "function"
    );
  } catch {
    return false;
  }
}

function cacheStorageImpl(): VoiceModelStorage | null {
  if (typeof caches === "undefined") return null;
  return {
    async get(key) {
      const cache = await caches.open(CACHE_NAME);
      const res = await cache.match(key);
      return res ? res.arrayBuffer() : null;
    },
    async put(key, bytes) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(key, new Response(bytes));
    },
    async clear() {
      await caches.delete(CACHE_NAME);
    },
  };
}

function opfsImpl(): VoiceModelStorage | null {
  if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) return null;
  const name = (key: string) => encodeURIComponent(key.replace(/^https?:\/\//, ""));
  const dir = async () =>
    (await navigator.storage.getDirectory()).getDirectoryHandle(OPFS_DIR, { create: true });
  return {
    async get(key) {
      try {
        const handle = await (await dir()).getFileHandle(name(key));
        return (await handle.getFile()).arrayBuffer();
      } catch {
        return null;
      }
    },
    async put(key, bytes) {
      const handle = await (await dir()).getFileHandle(name(key), { create: true });
      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
    },
    async clear() {
      try {
        await (await navigator.storage.getDirectory()).removeEntry(OPFS_DIR, { recursive: true });
      } catch {
        // absent is fine
      }
    },
  };
}

export function defaultVoiceModelStorage(): VoiceModelStorage {
  const impl = cacheStorageImpl() ?? opfsImpl();
  if (!impl)
    throw new DiError(
      "models.noStorage",
      undefined,
      "no persistent storage api (caches/opfs) available",
    );
  return impl;
}

function toDiError(err: unknown): unknown {
  if (err instanceof VoiceModelError) return new DiError(err.code, err.detail, err.message);
  return err;
}

export async function loadVoiceModelManifest(
  fetchImpl: typeof fetch = fetch,
): Promise<VoiceModelManifest> {
  try {
    return await loadManifestCore({ baseUrl: resolveVoiceModelsBase(), fetchImpl });
  } catch (err) {
    throw toDiError(err);
  }
}

export interface VoiceDownloadOptions {
  /** subset of manifest model ids; default = all */
  modelIds?: string[];
  manifest?: VoiceModelManifest;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  storage?: VoiceModelStorage;
  onProgress?: (state: VoiceDownloadState) => void;
}

let inflight: Promise<void> | null = null;

/**
 * Download every file of the requested models, verify sha256, write to the
 * model cache. Progress lands on $voiceDownload (and the optional callback).
 * Concurrent callers share one run — both layer sections can mount at once.
 */
export function downloadVoiceModels(opts: VoiceDownloadOptions = {}): Promise<void> {
  if (!inflight) {
    inflight = runVoiceModelDownload(opts).finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

async function runVoiceModelDownload(opts: VoiceDownloadOptions): Promise<void> {
  const storage = opts.storage ?? defaultVoiceModelStorage();
  const manifest = opts.manifest ?? (await loadVoiceModelManifest(opts.fetchImpl));
  let files;
  try {
    files = collectModelFiles(manifest, opts.modelIds);
  } catch (err) {
    throw toDiError(err);
  }
  const bytesTotal = files.reduce((sum, f) => sum + f.file.size, 0);
  let bytesDone = 0;
  const report = (partial: Partial<VoiceDownloadState>) => {
    const prev = $voiceDownload.get();
    const next: VoiceDownloadState = {
      ...prev,
      ...partial,
      bytesDone,
      bytesTotal,
      progress: bytesTotal > 0 ? Math.min(1, bytesDone / bytesTotal) : 0,
    };
    $voiceDownload.set(next);
    opts.onProgress?.(next);
  };
  report({ status: "downloading", error: undefined });
  try {
    await downloadVoiceModelFiles({
      files,
      storage,
      baseUrl: resolveVoiceModelsBase(),
      fetchImpl: opts.fetchImpl,
      signal: opts.signal,
      onFile: ({ bytesDone: done }) => {
        bytesDone = done;
        report({});
      },
    });
    report({ status: "ready" });
    await refreshVoiceModelsInstalled(manifest, storage);
  } catch (err) {
    console.error("[voice] model download failed:", err);
    report({ status: "error", error: errorCode(err) ?? "models.download" });
    throw toDiError(err);
  }
}

/** True when every file of `modelId` is present at the manifest's version. */
export async function voiceModelInstalled(
  modelId: string,
  manifest?: VoiceModelManifest,
  storage?: VoiceModelStorage,
): Promise<boolean> {
  return voiceModelInstalledCore(
    modelId,
    manifest ?? DEFAULT_VOICE_MODEL_MANIFEST,
    storage ?? defaultVoiceModelStorage(),
  );
}

export async function voiceModelBytesInstalled(
  manifest?: VoiceModelManifest,
  storage?: VoiceModelStorage,
): Promise<{ stt: boolean; tts: boolean }> {
  return voiceModelBytesInstalledCore(
    manifest ?? DEFAULT_VOICE_MODEL_MANIFEST,
    storage ?? defaultVoiceModelStorage(),
  );
}

/**
 * Re-verify the cache into $voiceModelsInstalled (called on load, consent
 * grant, layer pick, and after a download). A broken storage seam keeps
 * the last-known value rather than flipping the verdict to a false miss.
 */
export async function refreshVoiceModelsInstalled(
  manifest?: VoiceModelManifest,
  storage?: VoiceModelStorage,
): Promise<void> {
  try {
    $voiceModelsInstalled.set(await voiceModelBytesInstalled(manifest, storage));
  } catch {
    // keep last-known: a transient cache read error is not "uninstalled"
  }
}

/** Cached bytes for one manifest file (engine load path in phases c/d). */
export async function readVoiceModelFile(
  modelId: string,
  path: string,
  manifest?: VoiceModelManifest,
  storage?: VoiceModelStorage,
): Promise<ArrayBuffer | null> {
  return readVoiceModelFileCore(
    modelId,
    path,
    manifest ?? DEFAULT_VOICE_MODEL_MANIFEST,
    storage ?? defaultVoiceModelStorage(),
  );
}

export async function clearVoiceModels(storage?: VoiceModelStorage): Promise<void> {
  const store = storage ?? defaultVoiceModelStorage();
  await store.clear();
  $voiceDownload.set({ status: "idle", progress: 0, bytesDone: 0, bytesTotal: 0 });
  $voiceModelsInstalled.set({ stt: false, tts: false });
}
