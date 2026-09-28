import { TTS_TEST_TIMEOUT_MS } from "./timeouts";
import { DiError } from "./errors";
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
  return new Promise<void>((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(text);
    const timer = setTimeout(() => {
      speechSynthesis.cancel();
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
    speechSynthesis.speak(utterance);
  });
}

export interface ProbeDraft {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** /models probe shared by all sections: the endpoint class is the same. */
export async function probeModels(draft: ProbeDraft): Promise<void> {
  const base = draft.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  const res = await fetch(`${base}/v1/models`, {
    headers: { authorization: `Bearer ${draft.apiKey}` },
  });
  if (!res.ok) throw new DiError("http", { status: res.status }, `HTTP ${res.status}`);
}
