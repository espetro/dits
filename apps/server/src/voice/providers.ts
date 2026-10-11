/**
 * stt/tts provider resolution: "remote" (OpenAI-compatible http) vs
 * "builtin" (bundled wasm engines, zero-conf). The provider is inferred
 * from the config shape — explicit `provider` wins, otherwise a present
 * `base_url` means remote and its absence means builtin — so existing
 * remote configs keep working untouched and a bare/omitted section gets
 * the zero-conf default.
 */
import type { Stt, Tts } from "@di/shared";
import { ConfigError } from "../config/load.ts";

export type VoiceProvider = "remote" | "builtin";

export function sttProviderOf(stt: Stt): VoiceProvider {
  return stt.provider ?? (stt.base_url ? "remote" : "builtin");
}

export function ttsProviderOf(tts: Tts): VoiceProvider {
  return tts.provider ?? (tts.base_url ? "remote" : "builtin");
}

/** Narrow a resolved-remote stt section, failing loudly on missing fields. */
export function requireRemoteStt(stt: Stt): {
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
  mode: "buffered" | "streaming";
} {
  if (!stt.base_url || !stt.model) {
    throw new ConfigError("stt.provider=remote requires stt.base_url and stt.model");
  }
  return {
    baseUrl: stt.base_url,
    apiKey: stt.api_key,
    model: stt.model,
    mode: stt.mode ?? "streaming",
  };
}

/** Narrow a resolved-remote tts section, failing loudly on missing fields. */
export function requireRemoteTts(tts: Tts): {
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
  voice: string;
} {
  if (!tts.base_url || !tts.model || !tts.voice) {
    throw new ConfigError("tts.provider=remote requires tts.base_url, tts.model and tts.voice");
  }
  return {
    baseUrl: tts.base_url,
    apiKey: tts.api_key,
    model: tts.model,
    voice: tts.voice,
  };
}
