import * as v from "valibot";

/** OpenAI-compatible provider endpoint block. Every AI call uses this shape. */
export const ProviderSchema = v.object({
  provider: v.picklist(["openai", "anthropic", "mock"]),
  base_url: v.pipe(v.string(), v.url()),
  api_key: v.optional(v.string()),
  model: v.string(),
  /** Wire protocol for LLM calls; "anthropic" targets native /v1/messages. */
  flavor: v.optional(v.picklist(["openai", "anthropic"])),
  /**
   * Send OpenRouter-style `reasoning: {exclude: true}` on chat completions.
   * For gateways fronting reasoning models whose thinking eats the output
   * token budget. Accepts a boolean or the strings "true"/"false" (env
   * overrides arrive as strings).
   */
  reasoning_exclude: v.optional(
    v.pipe(
      v.union([v.boolean(), v.picklist(["true", "false"])]),
      v.transform((x) => x === true || x === "true"),
    ),
  ),
  /**
   * Send Z.AI-style `thinking: {type: "disabled"}` on chat completions.
   * Same purpose as reasoning_exclude (keep thinking out of the output
   * budget) for providers that speak the Z.AI dialect — they ignore the
   * OpenRouter param and vice versa, so both can be set at once.
   */
  thinking_disabled: v.optional(
    v.pipe(
      v.union([v.boolean(), v.picklist(["true", "false"])]),
      v.transform((x) => x === true || x === "true"),
    ),
  ),
  /**
   * Completion token cap. Required by the Anthropic /v1/messages wire
   * protocol; applied to OpenAI-compatible calls only when set.
   */
  max_tokens: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
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
  /**
   * Voice pipeline ops knobs. kickoff_ms paces the agent's opening
   * turn; max_tool_output caps tool results fed to the LLM (chars).
   */
  voice: v.optional(
    v.object({
      kickoff_ms: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
      max_tool_output: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
    }),
  ),
  /** `di --check` provider probes. */
  check: v.optional(
    v.object({
      timeout_ms: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
    }),
  ),
  /**
   * Document ingestion (RAG) tunables. max_files/max_total_bytes are the
   * server-enforced caps the SPA mirrors from DOCUMENT_CAPS; chunk_*
   * shape the embedder input; context_top_k is the retrieval depth.
   */
  documents: v.optional(
    v.object({
      max_files: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
      max_total_bytes: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
      chunk_size: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
      chunk_overlap: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
      context_top_k: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
    }),
  ),
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
