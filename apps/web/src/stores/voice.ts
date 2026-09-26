import { persistentAtom } from "@nanostores/persistent";
import { atom } from "nanostores";

/**
 * Browser-mode voice engine prefs. "on-device" is the default per the wasm
 * voice plan: it only takes effect once modelsConsent is "granted" AND the
 * model files are cached — otherwise the resolver falls back to builtin.
 */

export type SttEnginePick = "on-device" | "builtin";
export type TtsEnginePick = "on-device" | "builtin" | "endpoint";
export type VoiceModelsConsent = "granted" | "declined";

export const $voiceSttEngine = persistentAtom<SttEnginePick>("di.voice.sttEngine", "on-device");

/**
 * "" = never picked. Treated as "endpoint" when a BYO tts endpoint exists
 * (pre-wasm behavior), otherwise "on-device".
 */
export const $voiceTtsEngine = persistentAtom<TtsEnginePick | "">("di.voice.ttsEngine", "");

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

/** Session-scoped download progress; not persisted (cache is the truth). */
export const $voiceDownload = atom<VoiceDownloadState>({
  status: "idle",
  progress: 0,
  bytesDone: 0,
  bytesTotal: 0,
});
