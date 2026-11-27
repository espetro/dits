import * as v from "valibot";

/**
 * Server-owned provider settings. These are sparse per-field overrides stored
 * by the server in server-hosted mode; the server config yaml/env shape is
 * the base they are resolved against.
 *
 * Secret rule: `api_key` is write-only. It may be persisted locally so the
 * server can call the provider, but API/read-model shapes must use the
 * redacted schemas below (or `redactServerProviderSettings`) and must never
 * return the raw value.
 *
 * Null semantics: within a section, `undefined`/omitted means "no override
 * for this field" while `null` explicitly clears an inherited optional value.
 * Clearing a whole section is a repository/API operation, not a null section
 * value, so the meaning of null stays field-scoped and unambiguous.
 */

const NullableUrlSchema = v.nullable(v.pipe(v.string(), v.url()));
const NullableStringSchema = v.nullable(v.string());
const BooleanLikeSchema = v.pipe(
  v.union([v.boolean(), v.picklist(["true", "false"])]),
  v.transform((x) => x === true || x === "true"),
);

export const ServerProviderSettingsSectionSchema = v.picklist(["llm", "stt", "tts", "embeddings"]);
export type ServerProviderSettingsSection = v.InferOutput<
  typeof ServerProviderSettingsSectionSchema
>;

export const ServerLlmProviderSettingsSchema = v.object({
  provider: v.optional(v.picklist(["openai", "anthropic", "mock"])),
  base_url: v.optional(v.pipe(v.string(), v.url())),
  api_key: v.optional(NullableStringSchema),
  model: v.optional(v.string()),
  flavor: v.optional(v.nullable(v.picklist(["openai", "anthropic"]))),
  reasoning_exclude: v.optional(v.nullable(BooleanLikeSchema)),
  thinking_disabled: v.optional(v.nullable(BooleanLikeSchema)),
  max_tokens: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
});
export interface ServerLlmProviderSettings extends v.InferOutput<
  typeof ServerLlmProviderSettingsSchema
> {}

export const ServerSttProviderSettingsSchema = v.object({
  provider: v.optional(v.nullable(v.picklist(["remote", "builtin"]))),
  base_url: v.optional(NullableUrlSchema),
  api_key: v.optional(NullableStringSchema),
  model: v.optional(NullableStringSchema),
  mode: v.optional(v.nullable(v.picklist(["buffered", "streaming"]))),
});
export interface ServerSttProviderSettings extends v.InferOutput<
  typeof ServerSttProviderSettingsSchema
> {}

export const ServerTtsProviderSettingsSchema = v.object({
  provider: v.optional(v.nullable(v.picklist(["remote", "builtin"]))),
  base_url: v.optional(NullableUrlSchema),
  api_key: v.optional(NullableStringSchema),
  model: v.optional(NullableStringSchema),
  voice: v.optional(NullableStringSchema),
});
export interface ServerTtsProviderSettings extends v.InferOutput<
  typeof ServerTtsProviderSettingsSchema
> {}

export const ServerEmbeddingsProviderSettingsSchema = v.object({
  base_url: v.optional(NullableUrlSchema),
  api_key: v.optional(NullableStringSchema),
  model: v.optional(NullableStringSchema),
});
export interface ServerEmbeddingsProviderSettings extends v.InferOutput<
  typeof ServerEmbeddingsProviderSettingsSchema
> {}

/** Sparse server-owned settings document as persisted internally. Contains secrets. */
export const ServerProviderSettingsSchema = v.object({
  llm: v.optional(ServerLlmProviderSettingsSchema),
  stt: v.optional(ServerSttProviderSettingsSchema),
  tts: v.optional(ServerTtsProviderSettingsSchema),
  embeddings: v.optional(ServerEmbeddingsProviderSettingsSchema),
});
export interface ServerProviderSettings extends v.InferOutput<
  typeof ServerProviderSettingsSchema
> {}

/** Safe llm settings shape: every non-secret override plus key presence, never the key. */
export const RedactedServerLlmProviderSettingsSchema = v.object({
  provider: ServerLlmProviderSettingsSchema.entries.provider,
  base_url: ServerLlmProviderSettingsSchema.entries.base_url,
  api_key_set: v.boolean(),
  model: ServerLlmProviderSettingsSchema.entries.model,
  flavor: ServerLlmProviderSettingsSchema.entries.flavor,
  reasoning_exclude: ServerLlmProviderSettingsSchema.entries.reasoning_exclude,
  thinking_disabled: ServerLlmProviderSettingsSchema.entries.thinking_disabled,
  max_tokens: ServerLlmProviderSettingsSchema.entries.max_tokens,
});
export interface RedactedServerLlmProviderSettings extends v.InferOutput<
  typeof RedactedServerLlmProviderSettingsSchema
> {}

export const RedactedServerSttProviderSettingsSchema = v.object({
  provider: ServerSttProviderSettingsSchema.entries.provider,
  base_url: ServerSttProviderSettingsSchema.entries.base_url,
  api_key_set: v.boolean(),
  model: ServerSttProviderSettingsSchema.entries.model,
  mode: ServerSttProviderSettingsSchema.entries.mode,
});
export interface RedactedServerSttProviderSettings extends v.InferOutput<
  typeof RedactedServerSttProviderSettingsSchema
> {}

export const RedactedServerTtsProviderSettingsSchema = v.object({
  provider: ServerTtsProviderSettingsSchema.entries.provider,
  base_url: ServerTtsProviderSettingsSchema.entries.base_url,
  api_key_set: v.boolean(),
  model: ServerTtsProviderSettingsSchema.entries.model,
  voice: ServerTtsProviderSettingsSchema.entries.voice,
});
export interface RedactedServerTtsProviderSettings extends v.InferOutput<
  typeof RedactedServerTtsProviderSettingsSchema
> {}

export const RedactedServerEmbeddingsProviderSettingsSchema = v.object({
  base_url: ServerEmbeddingsProviderSettingsSchema.entries.base_url,
  api_key_set: v.boolean(),
  model: ServerEmbeddingsProviderSettingsSchema.entries.model,
});
export interface RedactedServerEmbeddingsProviderSettings extends v.InferOutput<
  typeof RedactedServerEmbeddingsProviderSettingsSchema
> {}

/** Sparse server-owned settings document safe for API responses and UI state. */
export const RedactedServerProviderSettingsSchema = v.object({
  llm: v.optional(RedactedServerLlmProviderSettingsSchema),
  stt: v.optional(RedactedServerSttProviderSettingsSchema),
  tts: v.optional(RedactedServerTtsProviderSettingsSchema),
  embeddings: v.optional(RedactedServerEmbeddingsProviderSettingsSchema),
});
export interface RedactedServerProviderSettings extends v.InferOutput<
  typeof RedactedServerProviderSettingsSchema
> {}

/** Stored-settings read model safe to expose over the API. */
export const ServerProviderSettingsReadModelSchema = v.object({
  settings: RedactedServerProviderSettingsSchema,
  created_at: v.pipe(v.string(), v.isoTimestamp()),
  updated_at: v.pipe(v.string(), v.isoTimestamp()),
});
export interface ServerProviderSettingsReadModel extends v.InferOutput<
  typeof ServerProviderSettingsReadModelSchema
> {}

const keyIsSet = (apiKey: string | null | undefined): boolean =>
  typeof apiKey === "string" && apiKey.length > 0;

const redactLlm = (section: ServerLlmProviderSettings): RedactedServerLlmProviderSettings => {
  const { api_key, ...rest } = section;
  return { ...rest, api_key_set: keyIsSet(api_key) };
};

const redactStt = (section: ServerSttProviderSettings): RedactedServerSttProviderSettings => {
  const { api_key, ...rest } = section;
  return { ...rest, api_key_set: keyIsSet(api_key) };
};

const redactTts = (section: ServerTtsProviderSettings): RedactedServerTtsProviderSettings => {
  const { api_key, ...rest } = section;
  return { ...rest, api_key_set: keyIsSet(api_key) };
};

const redactEmbeddings = (
  section: ServerEmbeddingsProviderSettings,
): RedactedServerEmbeddingsProviderSettings => {
  const { api_key, ...rest } = section;
  return { ...rest, api_key_set: keyIsSet(api_key) };
};

/**
 * Convert an internal settings document to the only shape safe to return or
 * log. Non-secret values are preserved exactly; every `api_key` is removed
 * and represented only by `api_key_set`.
 */
export function redactServerProviderSettings(
  settings: ServerProviderSettings,
): RedactedServerProviderSettings {
  const out: RedactedServerProviderSettings = {};
  if (settings.llm) out.llm = redactLlm(settings.llm);
  if (settings.stt) out.stt = redactStt(settings.stt);
  if (settings.tts) out.tts = redactTts(settings.tts);
  if (settings.embeddings) out.embeddings = redactEmbeddings(settings.embeddings);
  return out;
}
