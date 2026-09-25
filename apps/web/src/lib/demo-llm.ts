import { DEMO_LLM_BASE_URL, isManagedLlmBaseUrl } from "@di/shared";

/**
 * Zero-conf demo LLM (p2). In dev, VITE_DEMO_LLM_* env vars point the entry
 * at a chosen demo endpoint (key included, so no schema relaxation is
 * needed). Without them it defaults to the managed, rate-limited proxy url,
 * which accepts an empty apiKey.
 */
export const DEMO_LLM = {
  baseUrl: (import.meta.env.VITE_DEMO_LLM_BASE_URL as string | undefined) ?? DEMO_LLM_BASE_URL,
  apiKey: (import.meta.env.VITE_DEMO_LLM_API_KEY as string | undefined) ?? "",
  model: (import.meta.env.VITE_DEMO_LLM_MODEL as string | undefined) ?? "demo",
};

/** True when a configured llm endpoint is the managed/demo one (no key needed). */
export function isDemoLlm(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  const normalized = baseUrl.replace(/\/+$/, "");
  return isManagedLlmBaseUrl(normalized) || normalized === DEMO_LLM.baseUrl.replace(/\/+$/, "");
}

/** Demand-signal click log for the "unlimited zero-conf" CTA — localStorage only, best-effort. */
export function logDemoUpsellClick(): void {
  try {
    const key = "di.demoUpsellClicks";
    const prev = JSON.parse(localStorage.getItem(key) ?? "[]") as string[];
    prev.push(new Date().toISOString());
    localStorage.setItem(key, JSON.stringify(prev));
  } catch {
    // logging is best-effort; never block the UI on it
  }
}
