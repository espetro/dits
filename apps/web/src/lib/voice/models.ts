import * as v from "valibot";
import { VoiceModelManifestSchema } from "@di/shared";
import type { VoiceModelFile, VoiceModelManifest } from "@di/shared";
import { $voiceDownload } from "../../stores/voice";
import type { VoiceDownloadState } from "../../stores/voice";

/**
 * On-device voice model pipeline: manifest -> download (progress + sha256)
 * -> CacheStorage (OPFS fallback when the Cache API is unavailable, e.g. some
 * worker/embedded contexts). Models are never committed to git;
 * `VITE_VOICE_MODELS_BASE` points at an asset root serving manifest.json —
 * unset uses the baked-in manifest below (upstream cdn urls).
 */

const CACHE_NAME = "di-voice-models";
const OPFS_DIR = "voice-models";

export const VOICE_MODELS_BASE = import.meta.env.VITE_VOICE_MODELS_BASE as string | undefined;

/** Baked-in manifest: sherpa-onnx zipformer2-ctc small (stt) + KittenTTS nano (tts). */
export const DEFAULT_VOICE_MODEL_MANIFEST: VoiceModelManifest = {
  version: 1,
  models: {
    stt: {
      version: "zipformer2-ctc-en-small-2024-03-18",
      files: [
        {
          path: "stt/model.onnx",
          url: "https://huggingface.co/csukuangfj/icefall-asr-librispeech-streaming-zipformer-small-2024-03-18/resolve/main/exp-ctc-rnnt-small/ctc-epoch-30-avg-3-chunk-16-left-128.int8.onnx",
          size: 26_247_460,
          sha256: "d6746f4a034deea74b91091300eecc821e653fc8439a566cb8b5ba2d7a62bfd9",
        },
        {
          path: "stt/tokens.txt",
          url: "https://huggingface.co/csukuangfj/icefall-asr-librispeech-streaming-zipformer-small-2024-03-18/resolve/main/data/lang_bpe_500/tokens.txt",
          size: 5_048,
          sha256: "49e3c2646595fd907228b3c6787069658f67b17377c60aeb8619c4551b2316fb",
        },
      ],
    },
    tts: {
      version: "kitten-tts-nano-0.1",
      files: [
        {
          path: "tts/model.onnx",
          url: "https://huggingface.co/KittenML/kitten-tts-nano-0.1/resolve/main/kitten_tts_nano_v0_1.onnx",
          size: 23_847_845,
          sha256: "8818e8f06eb34bc9d17ba3987a9b513c5759e2f5f119b1242cfbb503d12bdc0a",
        },
        {
          path: "tts/voices.npz",
          url: "https://huggingface.co/KittenML/kitten-tts-nano-0.1/resolve/main/voices.npz",
          size: 10_294,
          sha256: "d1f3b3ce46c5fa79fa0019824bf572fea74f6a84c88b079cfecd700118d00b62",
        },
      ],
    },
  },
};

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

/** Cache key for one manifest file (synthetic url for CacheStorage). */
export function modelFileKey(modelId: string, version: string, path: string): string {
  return `https://di.local/voice-models/${modelId}/${path}?v=${encodeURIComponent(version)}`;
}

/** Storage seam: CacheStorage by default, OPFS when caches is missing. */
export interface VoiceModelStorage {
  get(key: string): Promise<ArrayBuffer | null>;
  put(key: string, bytes: ArrayBuffer): Promise<void>;
  clear(): Promise<void>;
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
  if (!impl) throw new Error("no persistent storage api (caches/opfs) available");
  return impl;
}

export async function loadVoiceModelManifest(
  fetchImpl: typeof fetch = fetch,
): Promise<VoiceModelManifest> {
  const base = VOICE_MODELS_BASE;
  if (!base) return DEFAULT_VOICE_MODEL_MANIFEST;
  const res = await fetchImpl(`${base.replace(/\/+$/, "")}/manifest.json`);
  if (!res.ok) throw new Error(`voice model manifest fetch failed: ${res.status}`);
  return v.parse(VoiceModelManifestSchema, await res.json());
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function resolveUrl(url: string, base: string | undefined): string {
  if (/^https?:\/\//.test(url)) return url;
  const root = (base ?? "").replace(/\/+$/, "");
  return `${root}/${url.replace(/^\/+/, "")}`;
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

/**
 * Download every file of the requested models, verify sha256, write to the
 * model cache. Progress lands on $voiceDownload (and the optional callback).
 */
export async function downloadVoiceModels(opts: VoiceDownloadOptions = {}): Promise<void> {
  const doFetch = opts.fetchImpl ?? fetch;
  const storage = opts.storage ?? defaultVoiceModelStorage();
  const manifest = opts.manifest ?? (await loadVoiceModelManifest(doFetch));
  const ids = opts.modelIds ?? Object.keys(manifest.models);
  const files: { modelId: string; version: string; file: VoiceModelFile }[] = [];
  for (const id of ids) {
    const entry = manifest.models[id];
    if (!entry) throw new Error(`unknown voice model: ${id}`);
    for (const file of entry.files) files.push({ modelId: id, version: entry.version, file });
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
    for (const { modelId, version, file } of files) {
      const res = await doFetch(resolveUrl(file.url, VOICE_MODELS_BASE), { signal: opts.signal });
      if (!res.ok) throw new Error(`download ${file.path} failed: ${res.status}`);
      const bytes = await res.arrayBuffer();
      if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
      if (bytes.byteLength !== file.size) {
        throw new Error(`download ${file.path} size ${bytes.byteLength} != manifest ${file.size}`);
      }
      const hex = await sha256Hex(bytes);
      if (hex !== file.sha256) throw new Error(`sha256 mismatch for ${file.path}`);
      await storage.put(modelFileKey(modelId, version, file.path), bytes);
      bytesDone += bytes.byteLength;
      report({});
    }
    report({ status: "ready" });
  } catch (err) {
    report({ status: "error", error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

/** True when every file of `modelId` is present at the manifest's version. */
export async function voiceModelInstalled(
  modelId: string,
  manifest?: VoiceModelManifest,
  storage?: VoiceModelStorage,
): Promise<boolean> {
  const m = manifest ?? DEFAULT_VOICE_MODEL_MANIFEST;
  const entry = m.models[modelId];
  if (!entry) return false;
  const store = storage ?? defaultVoiceModelStorage();
  for (const file of entry.files) {
    if (!(await store.get(modelFileKey(modelId, entry.version, file.path)))) return false;
  }
  return true;
}

export async function voiceModelBytesInstalled(
  manifest?: VoiceModelManifest,
  storage?: VoiceModelStorage,
): Promise<{ stt: boolean; tts: boolean }> {
  return {
    stt: await voiceModelInstalled("stt", manifest, storage),
    tts: await voiceModelInstalled("tts", manifest, storage),
  };
}

/** Cached bytes for one manifest file (engine load path in phases c/d). */
export async function readVoiceModelFile(
  modelId: string,
  path: string,
  manifest?: VoiceModelManifest,
  storage?: VoiceModelStorage,
): Promise<ArrayBuffer | null> {
  const m = manifest ?? DEFAULT_VOICE_MODEL_MANIFEST;
  const entry = m.models[modelId];
  if (!entry || !entry.files.some((f) => f.path === path)) return null;
  const store = storage ?? defaultVoiceModelStorage();
  return store.get(modelFileKey(modelId, entry.version, path));
}

export async function clearVoiceModels(storage?: VoiceModelStorage): Promise<void> {
  const store = storage ?? defaultVoiceModelStorage();
  await store.clear();
  $voiceDownload.set({ status: "idle", progress: 0, bytesDone: 0, bytesTotal: 0 });
}
