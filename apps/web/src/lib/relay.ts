/**
 * Browser-mode provider bridge: rewrite provider fetches to the di server's
 * `/v1/relay` so CORS-walled gateways (openrouter, local bifrost) work from
 * the SPA. Keys stay client-side (forwarded verbatim, never stored), and the
 * browser-direct fallback stays intact when the relay is inactive (public
 * site build, `VITE_VOICE_DEFAULT=browser`, or the managed demo endpoint
 * whose chat is CORS-enabled and whose turnstile tokens are solved and bound
 * browser-side).
 */
import { relayUrlPath } from "@di/shared";
import { $serverReachable, API_BASE } from "./runtime";
import { isDemoLlm } from "./demo-llm";

/** Headers the relay forwards upstream; everything else is dropped. */
const FORWARDED_HEADERS = ["authorization", "content-type", "cf-turnstile-response"] as const;

function pickForwardedHeaders(init?: RequestInit): Record<string, string> {
  const out: Record<string, string> = {};
  if (!init?.headers) return out;
  const append = (name: string, value: string): void => {
    if (FORWARDED_HEADERS.includes(name.toLowerCase() as (typeof FORWARDED_HEADERS)[number])) {
      out[name.toLowerCase()] = value;
    }
  };
  if (init.headers instanceof Headers) {
    init.headers.forEach((value, name) => append(name, value));
  } else if (Array.isArray(init.headers)) {
    for (const [name, value] of init.headers) append(name, value);
  } else {
    for (const [name, value] of Object.entries(init.headers)) append(name, value);
  }
  return out;
}

/**
 * True when provider calls should go through the di server relay: the health
 * probe answered and the endpoint is not the managed demo (demo chat is
 * CORS-enabled and turnstile tokens are solved browser-side, so proxying it
 * would break token/visitor binding).
 */
export function relayActive(baseUrl: string): boolean {
  return $serverReachable.get() === true && !isDemoLlm(baseUrl);
}

/**
 * Fetch that reroutes absolute http(s) urls through `${API_BASE}/v1/relay`
 * with the same method, body and signal, forwarding only the allowlisted
 * headers. Relative urls and other schemes pass through to plain fetch
 * untouched (same-origin paths are never hijacked).
 */
export function relayFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const upstream = input instanceof URL ? input.href : input;
  let parsed: URL | null = null;
  try {
    parsed = new URL(upstream);
  } catch {
    parsed = null;
  }
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    return fetch(upstream, init);
  }
  return fetch(`${API_BASE}${relayUrlPath(upstream)}`, {
    ...init,
    headers: pickForwardedHeaders(init),
  });
}

/** Fetch implementation shape threaded through providers and probes. */
export interface RelayFetch {
  (input: string | URL, init?: RequestInit): Promise<Response>;
}

/**
 * A fetch implementation for one endpoint: relay when active for its base
 * url, plain browser-direct fetch otherwise. Shared by createLlmModel,
 * report-generator and the settings probes so the seam is consistent.
 */
export function relayOrDirectFetch(baseUrl: string): RelayFetch {
  return (input, init) => (relayActive(baseUrl) ? relayFetch(input, init) : fetch(input, init));
}
