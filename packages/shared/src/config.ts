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
  /**
   * "remote" = OpenAI-compatible http service; "builtin" = bundled wasm
   * engines (zero-conf). Inferred from the shape when omitted: base_url
   * present => remote, absent => builtin.
   */
  provider: v.optional(v.picklist(["remote", "builtin"])),
  base_url: v.optional(v.pipe(v.string(), v.url())),
  api_key: v.optional(v.string()),
  /** remote: provider model id; builtin: ignored (manifest fixed). */
  model: v.optional(v.string()),
  /** remote transport mode; builtin engines are always streaming-native. */
  mode: v.optional(v.picklist(["buffered", "streaming"])),
});
export type Stt = v.InferOutput<typeof SttSchema>;

export const TtsSchema = v.object({
  /** "remote" = OpenAI-compatible http service; "builtin" = bundled wasm engine. */
  provider: v.optional(v.picklist(["remote", "builtin"])),
  base_url: v.optional(v.pipe(v.string(), v.url())),
  api_key: v.optional(v.string()),
  /** remote: provider model id; builtin: ignored (manifest fixed). */
  model: v.optional(v.string()),
  /** remote: provider voice id; builtin: voices.npz entry name. */
  voice: v.optional(v.string()),
});
export type Tts = v.InferOutput<typeof TtsSchema>;

/** Loopback bind used when server.host is omitted. */
export const DEFAULT_SERVER_HOST = "127.0.0.1";

const HOSTNAME_RE =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.?$/i;

function isValidIpv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part) || (part.length > 1 && part.startsWith("0"))) return false;
    return Number(part) <= 255;
  });
}

function isValidIpv6(value: string): boolean {
  if (!/^[0-9a-f:.]+$/i.test(value)) return false;
  if ((value.match(/::/g) ?? []).length > 1) return false;
  const hasIpv4Tail = value.includes(".");
  const compressed = value.split("::");
  if (compressed.length > 2) return false;

  const validateHexParts = (parts: string[]): boolean =>
    parts.every((part) => /^[0-9a-f]{1,4}$/i.test(part));

  if (compressed.length === 2) {
    const left = compressed[0] ? compressed[0]!.split(":") : [];
    const rightWithTail = compressed[1] ? compressed[1]!.split(":") : [];
    const right = hasIpv4Tail ? rightWithTail.slice(0, -1) : rightWithTail;
    if (hasIpv4Tail && !isValidIpv4(rightWithTail[rightWithTail.length - 1] ?? "")) {
      return false;
    }
    if (!validateHexParts(left) || !validateHexParts(right)) return false;
    return left.length + right.length + (hasIpv4Tail ? 2 : 0) < 8;
  }

  const parts = value.split(":");
  const hexParts = hasIpv4Tail ? parts.slice(0, -1) : parts;
  if (hasIpv4Tail && !isValidIpv4(parts[parts.length - 1] ?? "")) return false;
  if (!validateHexParts(hexParts)) return false;
  return hexParts.length + (hasIpv4Tail ? 2 : 0) === 8;
}

/** Bind hosts are bare hostnames or IPs: no scheme, port, userinfo, or IPv6 brackets. */
function isValidServerHost(host: string): boolean {
  if (host.length === 0 || host.length > 253 || host !== host.trim() || /\s/.test(host)) {
    return false;
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return isValidIpv4(host);
  if (host.includes(":")) return isValidIpv6(host);
  return HOSTNAME_RE.test(host);
}

function isHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

/**
 * Explicit cross-origin dev servers trusted by this di server. yaml uses an
 * array; env overrides can use the comma-separated string form.
 */
const DevOriginsSchema = v.pipe(
  v.union([v.array(v.string()), v.string()]),
  v.transform((value) =>
    typeof value === "string"
      ? value
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean)
      : value,
  ),
  v.array(v.pipe(v.string(), v.url(), v.check(isHttpOrigin, "must be an http(s) origin"))),
);

export const ConfigSchema = v.object({
  server: v.object({
    port: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535)),
    /** Bind host. Omitted means loopback-only (127.0.0.1). */
    host: v.optional(
      v.pipe(
        v.string(),
        v.check(
          isValidServerHost,
          "server.host must be a hostname or IP address, without scheme, port, or IPv6 brackets",
        ),
      ),
    ),
    /** Bearer-token auth for /v1 REST and the voice websocket when enabled. */
    auth: v.optional(v.picklist(["none", "token"]), "none"),
    /** High-entropy shared secret used when server.auth is token. Never logged. */
    token: v.optional(v.pipe(v.string(), v.regex(/^\S{16,}$/))),
    /** Extra browser origins allowed for local development; empty by default. */
    dev_origins: v.optional(DevOriginsSchema),
  }),
  llm: ProviderSchema,
  /** Voice engines. Omitted sections resolve to the bundled wasm engines. */
  stt: v.optional(SttSchema, {}),
  tts: v.optional(TtsSchema, {}),
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
