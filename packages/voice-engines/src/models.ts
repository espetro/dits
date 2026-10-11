/**
 * Voice model pipeline core: manifest -> download (sha256 + size verified)
 * -> a pluggable VoiceModelStorage seam. Runtime-agnostic: the browser
 * wires CacheStorage/OPFS impls and progress stores; the server wires the
 * fs storage in ./fs-storage.ts. Errors are plain Errors with a `code`
 * property — callers map them onto their own error types.
 */
import * as v from "valibot";
import { VoiceModelManifestSchema } from "@di/shared";
import type { VoiceModelFile, VoiceModelManifest } from "@di/shared";
import { DEFAULT_VOICE_MODEL_MANIFEST, modelFileKey } from "./manifest";

/** Storage seam: CacheStorage in the browser, a plain dir on the server. */
export interface VoiceModelStorage {
  get(key: string): Promise<ArrayBuffer | null>;
  put(key: string, bytes: ArrayBuffer): Promise<void>;
  clear(): Promise<void>;
}

/** An error carrying a stable machine-readable code (models.*). */
export class VoiceModelError extends Error {
  readonly code: string;
  readonly detail?: Record<string, string | number>;
  constructor(code: string, detail?: Record<string, string | number>, message?: string) {
    super(message ?? code);
    this.code = code;
    this.detail = detail;
  }
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function resolveUrl(url: string, base: string | undefined): string {
  if (/^https?:\/\//.test(url)) return url;
  const root = (base ?? "").replace(/\/+$/, "");
  return `${root}/${url.replace(/^\/+/, "")}`;
}

/**
 * Manifest resolution: `baseUrl` points at an asset root serving
 * manifest.json (deploy mirrors); absent falls back to the baked manifest.
 */
export async function loadVoiceModelManifest(opts: {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<VoiceModelManifest> {
  const base = opts.baseUrl?.replace(/\/+$/, "");
  if (!base) return DEFAULT_VOICE_MODEL_MANIFEST;
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(`${base}/manifest.json`);
  if (!res.ok)
    throw new VoiceModelError(
      "models.manifest",
      { status: res.status },
      `voice model manifest fetch failed: ${res.status}`,
    );
  return v.parse(VoiceModelManifestSchema, await res.json());
}

export interface VoiceModelFileJob {
  modelId: string;
  version: string;
  file: VoiceModelFile;
}

/** Flatten manifest entries for `modelIds` (default all) into file jobs. */
export function collectModelFiles(
  manifest: VoiceModelManifest,
  modelIds?: string[],
): VoiceModelFileJob[] {
  const ids = modelIds ?? Object.keys(manifest.models);
  const files: VoiceModelFileJob[] = [];
  for (const id of ids) {
    const entry = manifest.models[id];
    if (!entry) throw new VoiceModelError("models.unknown", { id }, `unknown voice model: ${id}`);
    for (const file of entry.files) files.push({ modelId: id, version: entry.version, file });
  }
  return files;
}

export interface DownloadVoiceModelFilesOptions {
  files: VoiceModelFileJob[];
  storage: VoiceModelStorage;
  /** Asset-root mirror for relative file urls. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Called after each verified file lands in storage. */
  onFile?: (done: { file: VoiceModelFileJob; bytesDone: number; bytesTotal: number }) => void;
}

/** Fetch each file, verify size + sha256, put into storage. */
export async function downloadVoiceModelFiles(opts: DownloadVoiceModelFilesOptions): Promise<void> {
  const doFetch = opts.fetchImpl ?? fetch;
  const bytesTotal = opts.files.reduce((sum, f) => sum + f.file.size, 0);
  let bytesDone = 0;
  for (const job of opts.files) {
    const res = await doFetch(resolveUrl(job.file.url, opts.baseUrl), {
      signal: opts.signal,
    });
    if (!res.ok)
      throw new VoiceModelError(
        "models.download",
        { status: res.status },
        `download ${job.file.path} failed: ${res.status}`,
      );
    const bytes = await res.arrayBuffer();
    if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
    if (bytes.byteLength !== job.file.size) {
      throw new VoiceModelError(
        "models.size",
        undefined,
        `download ${job.file.path} size ${bytes.byteLength} != manifest ${job.file.size}`,
      );
    }
    const hex = await sha256Hex(bytes);
    if (hex !== job.file.sha256)
      throw new VoiceModelError("models.sha256", undefined, `sha256 mismatch for ${job.file.path}`);
    await opts.storage.put(modelFileKey(job.modelId, job.version, job.file.path), bytes);
    bytesDone += bytes.byteLength;
    opts.onFile?.({ file: job, bytesDone, bytesTotal });
  }
}

/** True when every file of `modelId` is present at the manifest's version. */
export async function voiceModelInstalled(
  modelId: string,
  manifest: VoiceModelManifest,
  storage: VoiceModelStorage,
): Promise<boolean> {
  const entry = manifest.models[modelId];
  if (!entry) return false;
  for (const file of entry.files) {
    if (!(await storage.get(modelFileKey(modelId, entry.version, file.path)))) return false;
  }
  return true;
}

export async function voiceModelBytesInstalled(
  manifest: VoiceModelManifest,
  storage: VoiceModelStorage,
): Promise<{ stt: boolean; tts: boolean }> {
  return {
    stt: await voiceModelInstalled("stt", manifest, storage),
    tts: await voiceModelInstalled("tts", manifest, storage),
  };
}

/** Cached bytes for one manifest file (engine load path). */
export async function readVoiceModelFile(
  modelId: string,
  path: string,
  manifest: VoiceModelManifest,
  storage: VoiceModelStorage,
): Promise<ArrayBuffer | null> {
  const entry = manifest.models[modelId];
  if (!entry || !entry.files.some((f) => f.path === path)) return null;
  return storage.get(modelFileKey(modelId, entry.version, path));
}
