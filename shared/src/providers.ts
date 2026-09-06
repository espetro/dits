import * as v from "valibot";

/**
 * BYO (bring-your-own) provider profile for the custom (client-side) runtime:
 * the static web app talks directly to OpenAI-compatible endpoints with the
 * user's key. Keys live only in browser storage on the user's device and are
 * sent only to the configured base URLs (never query strings, never logs).
 *
 * The profile has three independent sections: stt, tts, llm. Each section is
 * optional; `undefined` means "use the in-browser fallback" for that
 * capability (Web Speech API for stt, speechSynthesis for tts). There is no
 * in-browser LLM fallback, so a usable profile always has an `llm` section.
 */

/** Wire protocol the endpoint speaks for LLM calls. */
export const FlavorSchema = v.picklist(["openai", "anthropic"]);
export type Flavor = v.InferOutput<typeof FlavorSchema>;

/** One LLM/STT-compatible endpoint configuration. */
export const ProviderEndpointSchema = v.object({
  /** OpenAI-compatible base URL, e.g. http://localhost:8317/v1 or a cloud endpoint */
  baseUrl: v.pipe(v.string(), v.url()),
  /** API key; treated as a secret, displayed redacted */
  apiKey: v.pipe(v.string(), v.minLength(1)),
  /** Model id for this endpoint */
  model: v.pipe(v.string(), v.minLength(1)),
  /** API flavor; "anthropic" targets native /v1/messages endpoints. */
  flavor: v.optional(FlavorSchema),
});

/** TTS endpoint: adds a voice selector (empty = provider default). */
export const TtsEndpointSchema = v.object({
  ...ProviderEndpointSchema.entries,
  /** /v1/audio/speech voice; empty = provider default */
  voice: v.optional(v.string(), ""),
});

/**
 * Per-section provider profile. stt/tts undefined = in-browser (Web Speech /
 * speechSynthesis); llm is required for the custom runtime to be usable.
 */
export const ProviderSectionsSchema = v.object({
  stt: v.optional(ProviderEndpointSchema),
  tts: v.optional(TtsEndpointSchema),
  llm: v.optional(ProviderEndpointSchema),
});
export type ProviderEndpoint = v.InferOutput<typeof ProviderEndpointSchema>;
export type TtsEndpoint = v.InferOutput<typeof TtsEndpointSchema>;
export type ProviderSections = v.InferOutput<typeof ProviderSectionsSchema>;

/**
 * Legacy flat profile (single endpoint shared by llm + tts). Kept only for
 * storage migration in the web $providerProfile decode.
 */
export const LegacyProviderProfileSchema = v.object({
  baseUrl: v.pipe(v.string(), v.url()),
  apiKey: v.pipe(v.string(), v.minLength(1)),
  llmModel: v.pipe(v.string(), v.minLength(1)),
  ttsVoice: v.optional(v.string(), ""),
  ttsModel: v.optional(v.string(), ""),
});

/**
 * Decode a stored profile: current sections shape first, then migrate the
 * legacy flat shape (llm + tts from the old fields; stt copies the endpoint
 * with the "whisper-1" default model); anything else is null.
 */
export function decodeProviderProfile(raw: string): ProviderSections | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  // legacy flat shape first: valibot strips unknown keys, so a legacy object
  // would otherwise parse as empty sections and fall through to null.
  if (typeof data === "object" && data !== null && "llmModel" in data) {
    const legacy = v.safeParse(LegacyProviderProfileSchema, data);
    if (legacy.success) {
      const old = legacy.output;
      return {
        stt: { baseUrl: old.baseUrl, apiKey: old.apiKey, model: "whisper-1", flavor: "openai" },
        tts: {
          baseUrl: old.baseUrl,
          apiKey: old.apiKey,
          model: old.ttsModel || "tts-1",
          voice: old.ttsVoice,
          flavor: "openai",
        },
        llm: { baseUrl: old.baseUrl, apiKey: old.apiKey, model: old.llmModel, flavor: "openai" },
      };
    }
    return null;
  }
  const sections = v.safeParse(ProviderSectionsSchema, data);
  if (sections.success) {
    // a sections-shaped profile without llm is unusable; drop it
    return sections.output.llm ? sections.output : null;
  }
  return null;
}

/**
 * Where the interview loop runs.
 * - "server": server-managed voice (di binary WebSocket pipeline), default.
 * - "custom": BYO per-section endpoints, client-side agent loop.
 * - "in-browser": Web Speech STT/TTS + custom LLM only (no STT/TTS endpoint).
 */
export const RuntimeModeSchema = v.picklist(["server", "custom", "in-browser"]);
export type RuntimeMode = v.InferOutput<typeof RuntimeModeSchema>;

/** localStorage key for the persisted runtime selection. */
export const RUNTIME_MODE_STORAGE_KEY = "di.runtime-mode";

/** localStorage key for the persisted provider profile. */
export const PROVIDER_PROFILE_STORAGE_KEY = "di.provider-profile";
