import * as v from "valibot";

/**
 * Relay contract for browser-mode provider calls. The di server exposes
 * `/v1/relay?url=<upstream>` and the web app points its provider fetches at
 * it when the server is reachable, so CORS-walled endpoints (openrouter,
 * local bifrost on localhost:8317) become same-origin. Provider keys live
 * only in the user's browser storage and are forwarded to the upstream as
 * the `authorization` header; the relay never logs that header (same
 * keys-never-logged rule as providers.ts).
 *
 * Loopback and intranet upstreams are deliberately allowed: bifrost at
 * localhost:8317 is a first-class case. The scheme is restricted to
 * http/https (no file: and friends) for ssrf hygiene.
 */

/** Base path of the relay route on the di server. */
export const RELAY_PATH = "/v1/relay";

function isHttpUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Query of the relay route: the absolute upstream url. Anything that is not
 * a well-formed http(s) url is rejected (v.url covers shape, the check
 * covers the scheme).
 */
export const RelayQuerySchema = v.object({
  url: v.pipe(v.string(), v.url(), v.check(isHttpUrl, "relay url must use http or https")),
});

/** Parsed relay query. */
export interface RelayQuery extends v.InferOutput<typeof RelayQuerySchema> {}

/**
 * Build the relay request path for an upstream url, so web and server
 * construct identical urls. The upstream is fully percent-encoded as the
 * `url` query param, so its own query and fragment survive the round trip.
 * Throws on an empty upstream.
 */
export function relayUrlPath(upstream: string): string {
  if (!upstream) throw new Error("relayUrlPath: upstream url must not be empty");
  return `${RELAY_PATH}?url=${encodeURIComponent(upstream)}`;
}
