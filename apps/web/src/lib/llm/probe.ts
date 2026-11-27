import { anthropicMessagesUrl, providerEndpoint, trimBaseUrl } from "@di/shared";
import { DiError } from "../errors";
import { isDemoLlm } from "../demo-llm";
import { relayActive, relayFetch } from "../relay";
import { $serverReachable, probeServer } from "../runtime";
import type { RelayFetch } from "../relay";
import { turnstileTokenFor } from "../turnstile";
import { createLlmModel } from "./adapters/browser";

export interface ProbeDraft {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** wire protocol; absent = openai-compatible */
  flavor?: "openai" | "anthropic";
}

/** Which transport a test or probe used; shown next to the verdict. */
export type LlmRoute = "relay" | "direct";

export interface LlmTestResult {
  text: string;
  route: LlmRoute;
  /** the model streamed reasoning but no visible text (still a working endpoint) */
  reasoningOnly: boolean;
}

/** A failed test, tagged with the route it took (null: failed before any call); `cause` is the underlying error. */
export class LlmTestError extends Error {
  readonly route: LlmRoute | null;
  constructor(route: LlmRoute | null, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "LlmTestError";
    this.route = route;
  }
}

/** Wall-clock budget for one Test: reasoning models can stream a long time. */
const TEST_TIMEOUT_MS = 30_000;
const TEST_PROMPT = "Reply with the single word: ok";
const ANTHROPIC_VERSION = "2023-06-01";

/** Anthropic native api: key header, version, and the browser opt-in (CORS). */
function anthropicHeaders(apiKey: string): Record<string, string> {
  return {
    "anthropic-version": ANTHROPIC_VERSION,
    "anthropic-dangerous-direct-browser-access": "true",
    ...(apiKey ? { "x-api-key": apiKey } : {}),
  };
}

/**
 * Re-verify the di server before choosing the route: a persisted or
 * not-yet-settled `$serverReachable` must not silently send the call
 * browser-direct (where CORS kills it for gateways like bifrost/ollama).
 * The managed demo endpoint never relays. Anthropic native calls never
 * relay either: the relay forwards only authorization, not x-api-key.
 */
async function chooseRoute(draft: ProbeDraft): Promise<LlmRoute> {
  if (isDemoLlm(draft.baseUrl) || draft.flavor === "anthropic") return "direct";
  await probeServer();
  return relayActive(draft.baseUrl) ? "relay" : "direct";
}

/** First blocking problem with a draft, as a coded error; null when testable. */
function testPrecondition(draft: ProbeDraft): DiError | null {
  if (!draft.baseUrl.trim()) return new DiError("llm.missingBaseUrl");
  if (!URL.canParse(draft.baseUrl)) return new DiError("llm.invalidBaseUrl");
  if (!draft.model.trim()) return new DiError("llm.missingModel");
  return null;
}

/** Short upstream error text: json `error.message` when present, else the raw body head. */
function bodyDetail(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } | string };
    const msg = typeof parsed.error === "string" ? parsed.error : parsed.error?.message;
    if (typeof msg === "string" && msg) return msg.slice(0, 200);
  } catch {
    // not json: fall through
  }
  return body.replace(/\s+/g, " ").trim().slice(0, 120);
}

/** A failed fetch (TypeError) means unreachable or CORS-blocked: say which route failed. */
function describeFailure(err: unknown, route: LlmRoute, timedOut: boolean): unknown {
  if (timedOut) return new DiError("llm.testTimeout", { seconds: TEST_TIMEOUT_MS / 1000 });
  if (err instanceof DiError) return err;
  if (err instanceof TypeError) {
    return new DiError(`llm.network.${route}`, undefined, err.message);
  }
  return err;
}

async function openAiTest(
  draft: ProbeDraft,
  route: LlmRoute,
  onText: (text: string) => void,
  signal: AbortSignal,
): Promise<{ text: string; reasoningOnly: boolean }> {
  const built = createLlmModel(
    { mode: "remote", baseUrl: draft.baseUrl, apiKey: draft.apiKey, model: draft.model },
    // the route was decided (and the server re-probed) up front; pin it
    { fetchImpl: (route === "relay" ? relayFetch : fetch) as typeof fetch },
  );
  if (!built) throw new DiError("llm.unsupported");
  const { streamText } = await import("ai");
  const { fullStream } = streamText({
    model: built.model,
    prompt: TEST_PROMPT,
    // generous: reasoning models reject or truncate tiny caps (<16)
    maxOutputTokens: 64,
    maxRetries: 0,
    abortSignal: signal,
  });
  let text = "";
  let reasoned = false;
  for await (const part of fullStream) {
    // textStream drops error parts, which hid every failure behind "empty"
    if (part.type === "error") throw part.error;
    if (part.type === "reasoning-delta") reasoned = true;
    if (part.type === "text-delta") {
      text += part.text;
      onText(text);
    }
    if (part.type === "finish" && (part.totalUsage?.outputTokens ?? 0) > 0) reasoned = true;
  }
  return { text, reasoningOnly: !text.trim() && reasoned };
}

async function anthropicTest(
  draft: ProbeDraft,
  onText: (text: string) => void,
  signal: AbortSignal,
): Promise<{ text: string; reasoningOnly: boolean }> {
  const res = await fetch(anthropicMessagesUrl(draft.baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", ...anthropicHeaders(draft.apiKey) },
    body: JSON.stringify({
      model: draft.model,
      max_tokens: 64,
      messages: [{ role: "user", content: TEST_PROMPT }],
    }),
    signal,
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new DiError(
      "llm.chat",
      { status: res.status, detail: bodyDetail(raw) },
      `llm chat failed: ${res.status} ${raw}`,
    );
  }
  let blocks: { type?: string; text?: string }[] = [];
  try {
    const parsed = JSON.parse(raw) as { content?: { type?: string; text?: string }[] };
    blocks = Array.isArray(parsed.content) ? parsed.content : [];
  } catch {
    throw new DiError("models.notJson", undefined, raw.slice(0, 80));
  }
  const text = blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
  if (text) onText(text);
  const reasoned = blocks.some((b) => b.type === "thinking" || b.type === "redacted_thinking");
  return { text, reasoningOnly: !text.trim() && reasoned };
}

/**
 * Fire one real short completion through the configured llm. Streams text
 * into onText and resolves the full text plus the route used. Every failure
 * throws a LlmTestError carrying that route and a coded cause: missing
 * fields, unreachable endpoint (per route), http / in-band errors, timeout,
 * and a stream with no text at all. A stream that carried reasoning but no
 * text resolves with `reasoningOnly` (the endpoint works).
 */
export async function runLlmTest(
  draft: ProbeDraft,
  onText: (text: string) => void,
  opts: { timeoutMs?: number } = {},
): Promise<LlmTestResult> {
  const problem = testPrecondition(draft);
  if (problem) throw new LlmTestError(null, problem);
  const route = await chooseRoute(draft);
  const signal = AbortSignal.timeout(opts.timeoutMs ?? TEST_TIMEOUT_MS);
  try {
    const out =
      draft.flavor === "anthropic"
        ? await anthropicTest(draft, onText, signal)
        : await openAiTest(draft, route, onText, signal);
    if (!out.text.trim() && !out.reasoningOnly) throw new DiError("llm.empty");
    return { ...out, route };
  } catch (err) {
    throw new LlmTestError(route, describeFailure(err, route, signal.aborted));
  }
}

/** Version-path candidates tried when a base url answers /models with html or 404. */
const BASE_URL_CANDIDATES = ["/v1", "/v4", "/api/v1"] as const;

function modelsUrl(baseUrl: string, flavor: ProbeDraft["flavor"]): string {
  return flavor === "anthropic"
    ? anthropicMessagesUrl(baseUrl).replace(/\/messages$/, "/models")
    : providerEndpoint(baseUrl, "/models");
}

async function fetchModelsJson(
  doFetch: RelayFetch,
  baseUrl: string,
  headers: Record<string, string>,
  flavor?: ProbeDraft["flavor"],
): Promise<{ res: Response; json: unknown }> {
  let res: Response;
  try {
    res = await doFetch(modelsUrl(baseUrl, flavor), { headers });
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
  const anthropic = draft.flavor === "anthropic";
  const headers: Record<string, string> = anthropic ? anthropicHeaders(draft.apiKey) : {};
  if (!anthropic && draft.apiKey) headers["authorization"] = `Bearer ${draft.apiKey}`;
  // first load: the health probe may not have settled; relay choice depends on it
  if ($serverReachable.get() === null && !anthropic) await probeServer();
  const relay = !anthropic && relayActive(draft.baseUrl);
  // relay mode is same-origin (no turnstile needed); the demo endpoint is
  // excluded from relay anyway, so browser-direct keeps solving tokens.
  // The managed demo worker requires a fresh turnstile token on /models
  // too — but a configured key is itself the credential and skips the gate
  const turnstile = relay || draft.apiKey ? null : await turnstileTokenFor(draft.baseUrl);
  if (turnstile) headers["cf-turnstile-response"] = turnstile;
  const doFetch: RelayFetch = relay ? relayFetch : fetch;
  try {
    const { json } = await fetchModelsJson(doFetch, draft.baseUrl, headers, draft.flavor);
    const ids = modelIds(json);
    if (!ids) throw new DiError("models.shape");
    return ids;
  } catch (err) {
    const missing =
      err instanceof DiError &&
      (err.code === "models.notJson" || (err.code === "http" && err.params?.status === 404));
    if (!missing || anthropic) throw err;
    const suggestion = await suggestBaseUrl(doFetch, draft.baseUrl, headers);
    if (suggestion) throw new DiError("models.suggest", { url: suggestion });
    throw err;
  }
}
