import * as v from "valibot";

/** OpenAI-compatible provider endpoint block. Every AI call uses this shape. */
export const ProviderSchema = v.object({
  provider: v.picklist(["openai", "anthropic", "mock"]),
  base_url: v.pipe(v.string(), v.url()),
  api_key: v.optional(v.string()),
  model: v.string(),
  /** Wire protocol for LLM calls; "anthropic" targets native /v1/messages. */
  flavor: v.optional(v.picklist(["openai", "anthropic"])),
});
export type Provider = v.InferOutput<typeof ProviderSchema>;

export const SttSchema = v.object({
  base_url: v.pipe(v.string(), v.url()),
  api_key: v.optional(v.string()),
  model: v.string(),
  /** Transport is streaming (WS frames); recognition is per-utterance buffered. Kept for compat. */
  mode: v.picklist(["buffered", "streaming"]),
});
export type Stt = v.InferOutput<typeof SttSchema>;

export const TtsSchema = v.object({
  base_url: v.pipe(v.string(), v.url()),
  api_key: v.optional(v.string()),
  model: v.string(),
  voice: v.string(),
});
export type Tts = v.InferOutput<typeof TtsSchema>;

export const ConfigSchema = v.object({
  server: v.object({
    port: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535)),
    /** auth middleware stub; inert in v1 */
    auth: v.optional(v.picklist(["none", "token"]), "none"),
  }),
  llm: ProviderSchema,
  stt: SttSchema,
  tts: TtsSchema,
  embeddings: v.optional(
    v.object({
      base_url: v.pipe(v.string(), v.url()),
      api_key: v.optional(v.string()),
      model: v.string(),
    }),
  ),
  phoenix: v.optional(
    v.object({
      endpoint: v.pipe(v.string(), v.url()),
      headers: v.optional(v.record(v.string(), v.string())),
    }),
  ),
  files: v.object({
    db_path: v.string(),
    log_path: v.string(),
    data_dir: v.string(),
  }),
});
export type Config = v.InferOutput<typeof ConfigSchema>;

export const CONFIG_ENV_PREFIX = "DI_";
/** Nested keys use double underscore: DI_LLM__API_KEY overrides llm.api_key. */
export const CONFIG_ENV_SEPARATOR = "__";

export function describeConfigError(
  issues: [v.InferIssue<typeof ConfigSchema>, ...v.InferIssue<typeof ConfigSchema>[]],
): string {
  return issues
    .map((i) => {
      const path = i.path?.map((p) => String(p.key)).join(".") ?? "(root)";
      return `config.${path}: ${i.message}`;
    })
    .join("\n");
}
