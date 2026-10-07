/**
 * Zero-conf demo LLM (p2). The endpoint is never committed: builds inject it
 * via VITE_DEMO_LLM_* env vars, so the shipped bundle is the only place the
 * url exists. The managed worker ingress resolves a Bearer token against
 * CLIENT_KEYS — an unregistered value is a hard 401 — so keyless is the
 * default: no authorization header is sent, and every request carries a
 * fresh Cloudflare Turnstile token instead (lib/turnstile.ts). A non-empty
 * VITE_DEMO_LLM_API_KEY is for issued dev/self-hosted client keys only.
 * When VITE_DEMO_LLM_BASE_URL is unset (local dev without env), the demo
 * affordances stay hidden.
 */
export const DEMO_LLM = {
  baseUrl: (import.meta.env.VITE_DEMO_LLM_BASE_URL as string | undefined) ?? "",
  apiKey: (import.meta.env.VITE_DEMO_LLM_API_KEY as string | undefined) ?? "",
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
