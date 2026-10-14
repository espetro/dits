import { TTS_TEST_TIMEOUT_MS } from "./timeouts";
import { DiError } from "./errors";
import { API_BASE } from "./runtime";
import { turnstileTokenFor } from "./turnstile";
import { relayActive, relayFetch, relayOrDirectFetch } from "./relay";
import type { RelayFetch } from "./relay";
import { providerEndpoint, trimBaseUrl } from "@di/shared";
import { createOpenAiCompatibleModel } from "./agent/openai-compatible-provider";
import { startCapture } from "./voice/capture";
import type { SttEngine } from "./voice/engines";
/**
 * Capability-aware in-browser speech/endpoint probes used by the AI
 * provider settings pane. Browser-only: all guards assume `window`.
 */

/** True when the browser exposes the Web Speech recognition constructor. */
export function hasBrowserStt(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(
      (window as unknown as Record<string, unknown>).SpeechRecognition ||
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition,
    )
  );
}

/**
 * In-browser STT test: start recognition briefly and resolve only if the
 * engine reports actual audio events; any error (not-allowed, no-speech,
 * network, ...) rejects.
 */
export function testBrowserStt(): Promise<void> {
  const Ctor =
    (window as unknown as Record<string, unknown>).SpeechRecognition ??
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
  if (typeof Ctor !== "function") return Promise.reject(new DiError("stt.unsupported"));
  const recognition = new (Ctor as new () => {
    start(): void;
    stop(): void;
    onresult: (() => void) | null;
    onerror: ((event: { error: string }) => void) | null;
  })();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      recognition.stop();
      resolve();
    }, 3000);
    recognition.onresult = () => {
      clearTimeout(timer);
      recognition.stop();
      resolve();
    };
    recognition.onerror = (event) => {
      clearTimeout(timer);
      reject(new DiError(sttErrorCode(event.error)));
    };
    recognition.start();
  });
}

/**
 * Map raw Web Speech error codes to `errors.stt.*` locale key suffixes.
 * "network" is the common desktop-Chrome trap: SpeechRecognition is
 * server-backed there, so a VPN/firewall/adblocker breaks it even though
 * the page is online (mobile Chrome often routes differently and works).
 */
function sttErrorCode(code: string): string {
  switch (code) {
    case "network":
      return "stt.network";
    case "not-allowed":
    case "service-not-allowed":
      return "stt.notAllowed";
    case "no-speech":
      return "stt.noSpeech";
    case "audio-capture":
      return "stt.noMic";
    case "language-not-supported":
      return "stt.langUnsupported";
    default:
      return "stt.unknown";
  }
}

/**
 * Live in-browser STT session: streams interim+final transcripts to
 * onText as the engine hears them. Returns a stop() handle; the session
 * also self-stops after `timeoutMs`. Errors (not-allowed, no-speech,
 * network, ...) are reported through onError.
 */
export function startLiveStt(handlers: {
  onText: (text: string) => void;
  /** reports an `errors.stt.*` code suffix — render via `codeMessage` */
  onError: (code: string) => void;
  timeoutMs?: number;
}): { stop: () => void } {
  const Ctor =
    (window as unknown as Record<string, unknown>).SpeechRecognition ??
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
  if (typeof Ctor !== "function") {
    handlers.onError("stt.unsupported");
    return { stop: () => undefined };
  }
  const recognition = new (Ctor as new () => {
    start(): void;
    stop(): void;
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onresult: ((event: SpeechRecognitionResultLikeEvent) => void) | null;
    onerror: ((event: { error: string }) => void) | null;
    onend: (() => void) | null;
  })();
  interface SpeechRecognitionResultLikeEvent {
    resultIndex: number;
    results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
  }
  let stopped = false;
  const timer = setTimeout(() => stop(), handlers.timeoutMs ?? 15_000);
  function stop(): void {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    try {
      recognition.stop();
    } catch {
      // already stopped
    }
  }
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = navigator.language ?? "en-US";
  recognition.onresult = (event) => {
    let text = "";
    for (let i = 0; i < event.results.length; i++) {
      const result = event.results[i];
      if (!result) continue;
      text += (result[0]?.transcript ?? "") + (result.isFinal ? " " : "");
    }
    handlers.onText(text.trim());
  };
  recognition.onerror = (event) => {
    stop();
    handlers.onError(sttErrorCode(event.error));
  };
  recognition.onend = () => stop();
  recognition.start();
  return { stop };
}

/** In-browser TTS test: resolve on `end`, reject on `error` or timeout. */
export function testBrowserTts(text = "hello"): Promise<void> {
  const synth = globalThis.speechSynthesis;
  if (!synth) return Promise.reject(new DiError("tts.builtin", undefined, "no speechSynthesis"));
  // desktop shells and headless browsers expose the api with zero voices:
  // speak() then neither plays nor errors, which looked like a passing test
  if (synth.getVoices().length === 0)
    return Promise.reject(new DiError("tts.builtin", undefined, "no voices installed"));
  return new Promise<void>((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(text);
    const timer = setTimeout(() => {
      synth.cancel();
      resolve();
    }, TTS_TEST_TIMEOUT_MS);
    utterance.onend = () => {
      clearTimeout(timer);
      resolve();
    };
    utterance.onerror = (event) => {
      clearTimeout(timer);
      reject(new DiError("tts.builtin", undefined, event.error));
    };
    synth.speak(utterance);
  });
}

/**
 * Server-layer tts test: the di server synthesizes through its configured
 * adapter (builtin kitten or remote endpoint) and returns a wav plus the
 * server-measured synth time.
 */
export async function testServerTts(text: string): Promise<{ clip: Blob; ms: number }> {
  const t0 = performance.now();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/v1/voice/tts-test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    throw new DiError("tts.server", { status: 0 }, err instanceof Error ? err.message : undefined);
  }
  if (!res.ok) {
    const detail = ((await res.json().catch(() => null)) as { error?: string } | null)?.error;
    throw new DiError("tts.server", { status: res.status }, detail);
  }
  const clip = await res.blob();
  const ms = Number(res.headers.get("x-synth-ms")) || Math.round(performance.now() - t0);
  return { clip, ms };
}

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
  const model = createOpenAiCompatibleModel(
    { baseUrl: draft.baseUrl, apiKey: draft.apiKey, model: draft.model },
    // probe/CORS-hostile endpoints only work through the server relay
    // when the di server is reachable (same rule as the dropdown probe)
    { fetchImpl: relayOrDirectFetch(draft.baseUrl) as typeof fetch },
  );
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

/**
 * Engine stt test (wasm/cloud): capture mic audio for the window, feed the
 * picked engine, then flush once — whatever was recognized lands in onText.
 * The selected mic is honored through the getUserMedia constraint.
 */
export async function startEngineSttTest(opts: {
  create(): Promise<SttEngine> | SttEngine;
  deviceId?: string;
  onText: (text: string) => void;
  onError: (message: string) => void;
  timeoutMs?: number;
}): Promise<{ stop: () => Promise<void> }> {
  const engine = await opts.create();
  const audio: MediaTrackConstraints | boolean = opts.deviceId
    ? { deviceId: { ideal: opts.deviceId } }
    : true;
  const capture = await startCapture({
    getUserMedia: (c) => navigator.mediaDevices.getUserMedia({ ...(c as object), audio }),
  });
  const out: string[] = [];
  let stopped = false;
  const timer = setTimeout(() => void stop(), opts.timeoutMs ?? 12_000);
  await engine.start({
    onFinal: (t) => {
      out.push(t);
      opts.onText(out.join(" "));
    },
    onInterim: () => undefined,
    onSpeechStart: () => undefined,
  });
  capture.onFloat32Frame?.((samples) => engine.feed(samples));
  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    try {
      await engine.flush();
    } catch (err) {
      opts.onError(err instanceof Error ? err.message : String(err));
    }
    await capture.stop().catch(() => undefined);
    await engine.stop().catch(() => undefined);
  }
  return { stop };
}
