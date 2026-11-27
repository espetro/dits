/**
 * Provider base URL joining. The configured base is authoritative: providers
 * use arbitrary version segments (`/v1`, zAI `/v4`, google `/v1beta/openai`,
 * openrouter `/api/v1`), so we only trim trailing slashes and append the
 * endpoint path. Never strip or inject a version segment.
 */

/** Trim trailing slashes from a provider base url. */
export function trimBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

/** Join a provider base url and an endpoint path (`/chat/completions`, `/models`, ...). */
export function providerEndpoint(baseUrl: string, path: string): string {
  return `${trimBaseUrl(baseUrl)}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Anthropic-flavor base urls are conventionally the bare host
 * (`https://api.anthropic.com`) while the messages path is `/v1/messages`;
 * accept either form so a base already ending in `/v1` is not doubled.
 */
export function anthropicMessagesUrl(baseUrl: string): string {
  const base = trimBaseUrl(baseUrl);
  return `${base.endsWith("/v1") ? base : `${base}/v1`}/messages`;
}
