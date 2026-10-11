import * as v from "valibot";

/**
 * Voice model manifest contract: the JSON document that drives the browser
 * downloader for on-device (wasm) stt/tts models. Served from
 * `VITE_VOICE_MODELS_BASE`/manifest.json when set, otherwise the web app
 * ships a baked-in default pointing at upstream cdns.
 *
 * Models are never committed to git; entries pin every file by sha256 and a
 * version string that, when bumped, forces a re-download.
 */

export const VoiceModelFileSchema = v.object({
  /** cache-relative path, e.g. "stt/model.onnx" */
  path: v.pipe(v.string(), v.minLength(1)),
  /** absolute download url, or a path resolved against the manifest base */
  url: v.pipe(v.string(), v.minLength(1)),
  /** expected byte size; used for progress accounting and a sanity check */
  size: v.pipe(v.number(), v.integer(), v.minValue(0)),
  /** lowercase hex sha256 of the file contents */
  sha256: v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/, "sha256 must be 64 lowercase hex chars")),
});
export type VoiceModelFile = v.InferOutput<typeof VoiceModelFileSchema>;

export const VoiceModelEntrySchema = v.object({
  /** opaque version tag; a bump invalidates the cached copy */
  version: v.pipe(v.string(), v.minLength(1)),
  files: v.pipe(v.array(VoiceModelFileSchema), v.minLength(1)),
});
export type VoiceModelEntry = v.InferOutput<typeof VoiceModelEntrySchema>;

export const VoiceModelManifestSchema = v.object({
  version: v.pipe(v.number(), v.integer(), v.minValue(1)),
  /** keyed by engine role: "stt" | "tts" */
  models: v.record(v.string(), VoiceModelEntrySchema),
});
export type VoiceModelManifest = v.InferOutput<typeof VoiceModelManifestSchema>;

/**
 * Server-side voice model cache status (GET /v1/voice/models): reports which
 * providers resolved to builtin wasm and the on-disk state of their model
 * pack under files.data_dir/models. Remote providers still get an entry
 * (installed flags meaningless — they own no local files).
 */
export const VoiceProviderKindSchema = v.picklist(["remote", "builtin"]);
export type VoiceProviderKind = v.InferOutput<typeof VoiceProviderKindSchema>;

export const VoiceModelCacheEntrySchema = v.object({
  installed: v.boolean(),
  /** manifest bytes currently present on disk */
  bytes_installed: v.pipe(v.number(), v.integer(), v.minValue(0)),
  /** manifest bytes expected when fully installed */
  bytes_total: v.pipe(v.number(), v.integer(), v.minValue(0)),
});
export interface VoiceModelCacheEntry {
  installed: boolean;
  bytes_installed: number;
  bytes_total: number;
}

export const VoiceModelsStatusSchema = v.object({
  providers: v.object({
    stt: VoiceProviderKindSchema,
    tts: VoiceProviderKindSchema,
  }),
  models: v.object({
    stt: VoiceModelCacheEntrySchema,
    tts: VoiceModelCacheEntrySchema,
  }),
  /** absolute path of the model cache dir */
  dir: v.pipe(v.string(), v.minLength(1)),
  /** active download, or null when idle */
  download: v.nullable(
    v.object({
      path: v.string(),
      bytes_done: v.pipe(v.number(), v.integer(), v.minValue(0)),
      bytes_total: v.pipe(v.number(), v.integer(), v.minValue(0)),
    }),
  ),
});
export type VoiceModelsStatus = v.InferOutput<typeof VoiceModelsStatusSchema>;
