/**
 * Known OpenAI-compatible providers and the base url each one serves its
 * `/models` and `/chat/completions` under. The base url is authoritative
 * (see provider-url.ts), so the version path is part of the preset.
 */
export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  { id: "zai", label: "Z.AI", baseUrl: "https://api.z.ai/api/paas/v4" },
  {
    id: "google",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  },
];

/** Preset whose base url matches the given one (trailing slashes ignored), if any. */
export function presetForBaseUrl(baseUrl: string): ProviderPreset | undefined {
  const root = baseUrl.replace(/\/+$/, "");
  return PROVIDER_PRESETS.find((p) => p.baseUrl === root);
}
