import type { Config } from "@di/shared";

/**
 * Probe each OpenAI-compatible provider with a minimal request.
 * In mock/mock-provider mode this hits the in-repo mock server.
 */
export async function probeProviders(config: Config): Promise<Record<string, boolean>> {
  const timeoutMs = config.check?.timeout_ms ?? 3000;
  const checks: Array<[string, Promise<boolean>]> = [
    ["llm", pingOpenAI(config.llm.base_url, config.llm.api_key, timeoutMs)],
    ["stt", pingRoot(config.stt.base_url, config.stt.api_key, timeoutMs)],
    ["tts", pingRoot(config.tts.base_url, config.tts.api_key, timeoutMs)],
  ];
  const out: Record<string, boolean> = {};
  for (const [name, p] of checks) {
    out[name] = await p;
  }
  return out;
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
