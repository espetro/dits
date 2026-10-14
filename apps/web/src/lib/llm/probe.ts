import { providerEndpoint, trimBaseUrl } from "@di/shared";
import { DiError } from "../errors";
import { relayActive, relayFetch } from "../relay";
import type { RelayFetch } from "../relay";
import { turnstileTokenFor } from "../turnstile";
import { createLlmModel } from "./adapters/browser";

export interface ProbeDraft {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * Fire one real short completion through the configured llm. Streams text
 * into onText and resolves the full text (empty = a genuinely empty
 * successful stream). Throws on any `error` stream part: textStream drops
 * those, which hid every http / relay / in-band failure behind a generic
 * "fields invalid" message.
 */
export async function runLlmTest(
  draft: ProbeDraft,
  onText: (text: string) => void,
): Promise<string> {
  // createLlmModel defaults remote sections to the relay-aware fetch, so
  // CORS-hostile endpoints work through the di server when reachable (same
  // rule as the dropdown probe)
  const built = createLlmModel({
    mode: "remote",
    baseUrl: draft.baseUrl,
    apiKey: draft.apiKey,
    model: draft.model,
  });
  if (!built) throw new DiError("llm.unsupported");
  const model = built.model;
  const { streamText } = await import("ai");
  const { fullStream } = streamText({
    model,
    prompt: "Reply with the single word: ok",
    maxOutputTokens: 5,
  });
  let text = "";
  for await (const part of fullStream) {
    if (part.type === "error") throw part.error;
    if (part.type === "text-delta") {
      text += part.text;
      onText(text);
    }
  }
  return text;
}

/** Version-path candidates tried when a base url answers /models with html or 404. */
const BASE_URL_CANDIDATES = ["/v1", "/v4", "/api/v1"] as const;

async function fetchModelsJson(
  doFetch: RelayFetch,
  baseUrl: string,
  headers: Record<string, string>,
): Promise<{ res: Response; json: unknown }> {
  let res: Response;
  try {
    res = await doFetch(providerEndpoint(baseUrl, "/models"), { headers });
  } catch (err) {
    throw new DiError("models.network", undefined, err instanceof Error ? err.message : undefined);
  }
  if (!res.ok) throw new DiError("http", { status: res.status }, `HTTP ${res.status}`);
  const text = await res.text();
  try {
    return { res, json: JSON.parse(text) as unknown };
  } catch {
    throw new DiError("models.notJson", undefined, text.slice(0, 80));
  }
}

function modelIds(json: unknown): string[] | null {
  const data = (json as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return null;
  return data
    .map((m) => (m as { id?: unknown } | null)?.id)
    .filter((id): id is string => typeof id === "string" && id !== "")
    .sort();
}

/** First candidate base url that serves a JSON /models list, or null. Hint only, never applied. */
async function suggestBaseUrl(
  doFetch: RelayFetch,
  baseUrl: string,
  headers: Record<string, string>,
): Promise<string | null> {
  const root = trimBaseUrl(baseUrl);
  const found = await Promise.all(
    BASE_URL_CANDIDATES.map(async (suffix) => {
      const candidate = `${root}${suffix}`;
      try {
        const { json } = await fetchModelsJson(doFetch, candidate, headers);
        return modelIds(json) ? candidate : null;
      } catch {
        return null;
      }
    }),
  );
  return found.find((c) => c !== null) ?? null;
}

/**
 * /models probe shared by all sections: the endpoint class is the same.
 * Resolves the sorted model ids; every failure throws a coded DiError
 * (`http`, `models.network`, `models.notJson`, `models.shape`,
 * `models.suggest`) so the UI can say why the list is empty.
 */
export async function probeModels(draft: ProbeDraft): Promise<string[]> {
  // keyless endpoints must send no authorization header at all — an empty
  // Bearer still forces a CORS preflight some gateways reject
  const headers: Record<string, string> = {};
  if (draft.apiKey) headers["authorization"] = `Bearer ${draft.apiKey}`;
  const relay = relayActive(draft.baseUrl);
  // relay mode is same-origin (no turnstile needed); the demo endpoint is
  // excluded from relay anyway, so browser-direct keeps solving tokens.
  // The managed demo worker requires a fresh turnstile token on /models
  // too — but a configured key is itself the credential and skips the gate
  const turnstile = relay || draft.apiKey ? null : await turnstileTokenFor(draft.baseUrl);
  if (turnstile) headers["cf-turnstile-response"] = turnstile;
  const doFetch: RelayFetch = relay ? relayFetch : fetch;
  try {
    const { json } = await fetchModelsJson(doFetch, draft.baseUrl, headers);
    const ids = modelIds(json);
    if (!ids) throw new DiError("models.shape");
    return ids;
  } catch (err) {
    const missing =
      err instanceof DiError &&
      (err.code === "models.notJson" || (err.code === "http" && err.params?.status === 404));
    if (!missing) throw err;
    const suggestion = await suggestBaseUrl(doFetch, draft.baseUrl, headers);
    if (suggestion) throw new DiError("models.suggest", { url: suggestion });
    throw err;
  }
}
