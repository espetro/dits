import type { Config, ServerProviderSettings } from "@di/shared";

/** Effective provider config consumed by server-hosted voice, checks and report generation. */
export interface ResolvedProviderConfig {
  llm: Config["llm"];
  stt: Config["stt"];
  tts: Config["tts"];
}

/**
 * Apply sparse server-owned settings over the yaml/env-loaded config.
 *
 * Merge semantics are field-scoped:
 * - an omitted field inherits the yaml/env value;
 * - a present value is authoritative and wins over yaml/env;
 * - `null` suppresses an inherited optional value (for example clearing a
 *   base stt base_url can return stt to the builtin provider by shape);
 * - clearing a whole section in the store removes all of these overrides,
 *   restoring yaml/env for that section.
 *
 * The overlay is intentionally sparse so saving one field does not duplicate
 * or freeze unrelated secrets and endpoint defaults. Once a field is saved,
 * later yaml/env edits no longer affect that field in server-hosted mode.
 *
 * Embeddings contracts exist in shared for persistence/API symmetry, but this
 * resolver is scoped to the interview runtime seams: llm, stt and tts.
 */
export function resolveProviderConfig(
  base: Config,
  settings: ServerProviderSettings | null | undefined,
): ResolvedProviderConfig {
  return {
    llm: mergeSection(base.llm, settings?.llm),
    stt: mergeSection(base.stt, settings?.stt),
    tts: mergeSection(base.tts, settings?.tts),
  };
}

function mergeSection<T extends object>(base: T, override: object | undefined): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(base)) out[key] = value;
  if (!override) return out as T;
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    if (value === null) delete out[key];
    else out[key] = value;
  }
  return out as T;
}
