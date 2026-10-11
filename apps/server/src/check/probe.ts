import type { Config } from "@di/shared";
import { sttProviderOf, ttsProviderOf } from "../voice/providers.ts";
import { resolveVoiceRuntime } from "../voice/builtin/runtime.ts";
import { builtinModelsInstalled, ensureBuiltinModels } from "../voice/builtin/models.ts";

/**
 * Probe each provider with a minimal request. Remote providers get an http
 * ping; builtin providers check the wasm runtime files and the model cache
 * (pulling missing models once — the probe is the zero-conf readiness check).
 */
export async function probeProviders(config: Config): Promise<Record<string, boolean>> {
  const timeoutMs = config.check?.timeout_ms ?? 3000;
  const checks: Array<[string, Promise<boolean>]> = [
    ["llm", pingOpenAI(config.llm.base_url, config.llm.api_key, timeoutMs)],
    ["stt", probeStt(config, timeoutMs)],
    ["tts", probeTts(config)],
  ];
  const out: Record<string, boolean> = {};
  for (const [name, p] of checks) {
    out[name] = await p;
  }
  return out;
}

async function probeStt(config: Config, timeoutMs: number): Promise<boolean> {
  if (sttProviderOf(config.stt) === "remote") {
    if (!config.stt.base_url) return false;
    return pingRoot(config.stt.base_url, config.stt.api_key, timeoutMs);
  }
  return probeBuiltin(config, "stt");
}

async function probeTts(config: Config): Promise<boolean> {
  if (ttsProviderOf(config.tts) === "remote") {
    if (!config.tts.base_url) return false;
    return pingRoot(config.tts.base_url, config.tts.api_key, config.check?.timeout_ms ?? 3000);
  }
  return probeBuiltin(config, "tts");
}

async function probeBuiltin(config: Config, kind: "stt" | "tts"): Promise<boolean> {
  try {
    if (!resolveVoiceRuntime()) return false;
    // models auto-pull at boot; a probe run before that finishes verifies
    // the cache or performs the pull itself (one-time ~50MB).
    const installed = await builtinModelsInstalled(config.files.data_dir);
    if (installed[kind]) return true;
    await ensureBuiltinModels(config.files.data_dir, { modelIds: [kind] });
    return (await builtinModelsInstalled(config.files.data_dir))[kind];
  } catch {
    return false;
  }
}

async function pingOpenAI(
  base: string,
  key: string | undefined,
  timeoutMs: number,
): Promise<boolean> {
  try {
    const res = await fetch(`${base}/models`, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function pingRoot(
  base: string,
  key: string | undefined,
  timeoutMs: number,
): Promise<boolean> {
  try {
    const res = await fetch(base, {
      method: "GET",
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.status < 500;
  } catch {
    return false;
  }
}
