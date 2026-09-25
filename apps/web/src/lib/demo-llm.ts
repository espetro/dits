/**
 * Zero-conf demo LLM (p2). The endpoint is never committed: builds inject it
 * via VITE_DEMO_LLM_* env vars, so the shipped bundle is the only place the
 * url exists. The managed endpoint ignores the api key, so the fill plants a
 * placeholder just to satisfy the profile schema. When VITE_DEMO_LLM_BASE_URL
 * is unset (local dev without env), the demo affordances stay hidden.
 */
export const DEMO_LLM = {
  baseUrl: (import.meta.env.VITE_DEMO_LLM_BASE_URL as string | undefined) ?? "",
  apiKey: (import.meta.env.VITE_DEMO_LLM_API_KEY as string | undefined) ?? "demo",
  model: (import.meta.env.VITE_DEMO_LLM_MODEL as string | undefined) ?? "demo",
};

/** Demo fill is offered only when the build carries a demo endpoint. */
export const DEMO_LLM_ENABLED = DEMO_LLM.baseUrl !== "";

/** True when a configured llm endpoint is the demo one. */
export function isDemoLlm(baseUrl: string | undefined): boolean {
  if (!baseUrl || !DEMO_LLM_ENABLED) return false;
  return baseUrl.replace(/\/+$/, "") === DEMO_LLM.baseUrl.replace(/\/+$/, "");
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
