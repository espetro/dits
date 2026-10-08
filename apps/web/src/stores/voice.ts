import { persistentAtom } from "@nanostores/persistent";
import { atom } from "nanostores";

/**
 * Per-layer voice engine picks. Each speech layer is independently
 * configurable (the old di.runtime-mode global is gone):
 *
 * - "server": the di desktop app runs this seam (.cpp sidecars). Only
 *   resolvable when the di server hosts the app; the voice driver is
 *   all-or-nothing, so a server pick only takes effect when BOTH stt and
 *   tts resolve server-side — otherwise the seam degrades to the
 *   in-browser chain and the status view explains why.
 * - "in-browser": the browser built-in (Web Speech SpeechRecognition /
 *   speechSynthesis). Zero download, lowest quality.
 * - "wasm": the on-device wasm engine (sherpa-onnx zipformer / KittenTTS).
 *   Resolves only with consent + verified model files + wasm support;
 *   otherwise falls back to in-browser.
 * - "cloud": a BYO OpenAI-compatible endpoint (provider profile).
 * - "" (auto, default): server when the di server is reachable, otherwise
 *   the wasm-then-in-browser chain. Preserves the pre-restructure defaults
 *   on every deployment.
 */
export type SttLayerPick = "server" | "in-browser" | "wasm" | "cloud" | "";
export type TtsLayerPick = "server" | "in-browser" | "wasm" | "cloud" | "";
export type VoiceModelsConsent = "granted" | "declined";

// legacy stored values -> current picks
function decodePick(raw: string): SttLayerPick {
  switch (raw) {
    case "server":
    case "in-browser":
    case "wasm":
    case "cloud":
      return raw;
    case "builtin":
      return "in-browser";
    case "on-device":
      return "wasm";
    case "endpoint":
      return "cloud";
    default:
      return "";
  }
}

/** Migrate the dropped di.runtime-mode pref into per-layer picks (once). */
function migrateRuntimeMode(): void {
  try {
    // di.runtime-mode persisted raw (encode: identity); the engine stores
    // below do too — read and write plain values, no JSON.
    const mode = localStorage.getItem("di.runtime-mode");
    if (mode === null) return;
    localStorage.removeItem("di.runtime-mode");
    if (mode === "server" || mode === "local-server") {
      localStorage.setItem("di.voice.sttEngine", "server");
      localStorage.setItem("di.voice.ttsEngine", "server");
    }
    // custom / in-browser: the engine picks were always the effective
    // choice in browser mode — their own migration below handles them.
  } catch {
    // storage unavailable or corrupt: leave defaults
  }
}
if (typeof window !== "undefined") migrateRuntimeMode();

/** "" = auto (server when di-hosted, else the on-device chain). */
export const $voiceSttEngine = persistentAtom<SttLayerPick>("di.voice.sttEngine", "", {
  encode: String,
  decode: decodePick,
});

export const $voiceTtsEngine = persistentAtom<TtsLayerPick>("di.voice.ttsEngine", "", {
  encode: String,
  decode: decodePick,
});

/** unset = never asked; the consent dialog only shows while unset. */
export const $voiceModelsConsent = persistentAtom<VoiceModelsConsent | "">(
  "di.voice.modelsConsent",
  "",
);

export interface VoiceDownloadState {
  status: "idle" | "downloading" | "ready" | "error";
  /** 0..1 across all files */
  progress: number;
  bytesDone: number;
  bytesTotal: number;
  error?: string;
}

/**
 * Consent-prompt visibility. Set true at a point of need (first browser-mode
 * interview entry, or picking an on-device engine while unconsented); the
 * VoiceConsentDialog mounts once at the root and renders while this is true
 * and consent is not "granted".
 */
export const $voiceConsentPrompt = atom(false);

/** Ask for the on-device models download consent (re-arms after a decline). */
export function requestVoiceConsent(): void {
  if ($voiceModelsConsent.get() !== "granted") $voiceConsentPrompt.set(true);
}

/** Session-scoped download progress; not persisted (cache is the truth). */
export const $voiceDownload = atom<VoiceDownloadState>({
  status: "idle",
  progress: 0,
  bytesDone: 0,
  bytesTotal: 0,
});
