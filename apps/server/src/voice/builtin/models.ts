/**
 * Server-side voice model cache: manifest files land at
 * `<files.data_dir>/models/<manifest path>` (e.g. models/stt/model.onnx) so
 * sherpa's fs-path model API can read them directly — no opaque storage
 * keys needed. sha256 + size verified via the shared download core.
 * `DI_VOICE_MODELS_BASE` mirrors the browser's manifest-override env for
 * deployments that need to point at an internal asset root.
 */
import { existsSync, mkdirSync } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  collectModelFiles,
  DEFAULT_VOICE_MODEL_MANIFEST,
  loadVoiceModelManifest,
  resolveUrl,
  sha256Hex,
} from "@di/voice-engines";
import type { Config, VoiceModelManifest } from "@di/shared";
import { sttProviderOf, ttsProviderOf } from "../providers.ts";

export function builtinModelsDir(dataDir: string): string {
  return join(dataDir, "models");
}

export function builtinModelPath(dataDir: string, path: string): string {
  return join(builtinModelsDir(dataDir), path);
}

function manifestForEnv(fetchImpl?: typeof fetch): Promise<VoiceModelManifest> {
  const base = process.env.DI_VOICE_MODELS_BASE;
  if (!base) return Promise.resolve(DEFAULT_VOICE_MODEL_MANIFEST);
  return loadVoiceModelManifest({ baseUrl: base, fetchImpl });
}

interface FilePresence {
  sizeOk: boolean;
}

async function filePresent(path: string, size: number): Promise<FilePresence> {
  try {
    const s = await stat(path);
    return { sizeOk: s.size === size };
  } catch {
    return { sizeOk: false };
  }
}

/** Per-model installed verdict (all manifest files present + size match). */
export async function builtinModelsInstalled(
  dataDir: string,
  manifest?: VoiceModelManifest,
): Promise<{ stt: boolean; tts: boolean }> {
  const m = manifest ?? DEFAULT_VOICE_MODEL_MANIFEST;
  const check = async (id: string) => {
    const entry = m.models[id];
    if (!entry) return false;
    for (const f of entry.files) {
      const p = builtinModelPath(dataDir, f.path);
      if (!existsSync(p) || !(await filePresent(p, f.size)).sizeOk) return false;
    }
    return true;
  };
  return { stt: await check("stt"), tts: await check("tts") };
}

const inflight = new Map<string, Promise<void>>();

export interface EnsureBuiltinModelsOptions {
  modelIds?: string[];
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  onFile?: (path: string, bytesDone: number, bytesTotal: number) => void;
}

/**
 * Download missing manifest files into the data dir. Callers share one
 * in-flight run per dataDir (cli warm + engine lazy-boot + --check probe).
 */
export function ensureBuiltinModels(
  dataDir: string,
  opts: EnsureBuiltinModelsOptions = {},
): Promise<void> {
  const key = `${dataDir}::${(opts.modelIds ?? []).join(",")}`;
  let run = inflight.get(key);
  if (!run) {
    run = doEnsure(dataDir, opts).finally(() => inflight.delete(key));
    inflight.set(key, run);
  }
  return run;
}

async function doEnsure(dataDir: string, opts: EnsureBuiltinModelsOptions): Promise<void> {
  const doFetch = opts.fetchImpl ?? fetch;
  const base = process.env.DI_VOICE_MODELS_BASE;
  const manifest = await manifestForEnv(doFetch);
  const files = collectModelFiles(manifest, opts.modelIds);
  const bytesTotal = files.reduce((sum, f) => sum + f.file.size, 0);
  let bytesDone = 0;
  for (const job of files) {
    const dest = builtinModelPath(dataDir, job.file.path);
    if (existsSync(dest) && (await filePresent(dest, job.file.size)).sizeOk) {
      bytesDone += job.file.size;
      continue;
    }
    const res = await doFetch(resolveUrl(job.file.url, base), { signal: opts.signal });
    if (!res.ok) throw new Error(`voice model download ${job.file.path} failed: ${res.status}`);
    const bytes = await res.arrayBuffer();
    if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
    if (bytes.byteLength !== job.file.size)
      throw new Error(
        `voice model ${job.file.path} size ${bytes.byteLength} != manifest ${job.file.size}`,
      );
    const hex = await sha256Hex(bytes);
    if (hex !== job.file.sha256) throw new Error(`voice model ${job.file.path} sha256 mismatch`);
    mkdirSync(join(dest, ".."), { recursive: true });
    await writeFile(dest, Buffer.from(bytes));
    bytesDone += bytes.byteLength;
    opts.onFile?.(job.file.path, bytesDone, bytesTotal);
  }
}

/**
 * Boot-time model warm for whichever providers resolved to builtin. Never
 * throws: a failed pull just means the first session pays the download
 * (or fails loudly there), which beats delaying startup.
 */
export function warmBuiltinModels(config: Config): void {
  const ids: string[] = [];
  if (sttProviderOf(config.stt) === "builtin") ids.push("stt");
  if (ttsProviderOf(config.tts) === "builtin") ids.push("tts");
  if (ids.length === 0) return;
  void ensureBuiltinModels(config.files.data_dir, {
    modelIds: ids,
    onFile: (path, done, total) =>
      console.log(`[di] voice model ${path} (${Math.round((done / total) * 100)}%)`),
  }).catch((err) =>
    console.warn(`[di] builtin voice model download failed: ${err}; will retry on first use`),
  );
}
