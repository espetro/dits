import { $voiceModelsConsent, $voiceSttEngine, $voiceTtsEngine } from "../../stores/voice";
import type { SttEnginePick, TtsEnginePick } from "../../stores/voice";
import { $providerProfile } from "../runtime";
import {
  DEFAULT_VOICE_MODEL_MANIFEST,
  loadVoiceModelManifest,
  voiceModelBytesInstalled,
  wasmVoiceSupported,
} from "./models";

/**
 * Browser-mode voice engines. The BrowserVoiceDriver keeps owning turn
 * orchestration; engines only do recognition/synthesis behind these seams:
 * `handleResult`/`runAgentTurn` for stt, `speak()`/`ttsMode` for tts.
 *
 * Engine ids:
 * - stt: "wasm" (sherpa-onnx streaming zipformer, on-device) | "builtin"
 *   (Web Speech SpeechRecognition).
 * - tts: "wasm" (KittenTTS worker) | "builtin" (speechSynthesis) |
 *   "endpoint" (BYO /v1/audio/speech via profile.tts).
 */

export interface SttEngineCallbacks {
  onFinal(text: string): void;
  onInterim(text: string): void;
  onSpeechStart(): void;
}

export interface SttEngine {
  start(opts: SttEngineCallbacks): Promise<void>;
  /** 16kHz mono Float32 frames straight from MicCaptureImpl. */
  feed(frame: Float32Array): void;
  /**
   * Utterance boundary (the main-thread vad fires this on speech end):
   * drain the stream and emit onFinal with whatever was heard.
   */
  flush(): Promise<void>;
  stop(): Promise<void>;
}

export interface TtsEngine {
  /** Synthesize one sentence; returns PCM at the engine's native rate. */
  speak(sentence: string): Promise<Float32Array>;
  dispose(): void;
}

export type SttEngineId = "wasm" | "builtin";
export type TtsEngineId = "wasm" | "builtin" | "endpoint";

export interface VoiceEngineInput {
  sttPick: SttEnginePick;
  /** "" = never picked (see stores/voice) */
  ttsPick: TtsEnginePick | "";
  /** consent store value: "granted" | "declined" | "" */
  consent: string;
  /** model files verified in the cache */
  sttReady: boolean;
  ttsReady: boolean;
  /** wasm + simd usable in this browser */
  supported: boolean;
  /** a BYO tts endpoint is configured (profile.tts) */
  hasTtsEndpoint: boolean;
}

export interface ResolvedVoiceEngines {
  stt: SttEngineId;
  tts: TtsEngineId;
}

function onDeviceReady(consent: string, ready: boolean, supported: boolean): boolean {
  return supported && consent === "granted" && ready;
}

/**
 * Effective engines for browser mode. On-device requires consent + a
 * verified download + wasm support; anything short falls back without a
 * dead voice loop: stt -> builtin; tts -> endpoint when configured, else
 * builtin.
 */
export function resolveVoiceEngines(input: VoiceEngineInput): ResolvedVoiceEngines {
  const stt: SttEngineId =
    input.sttPick === "on-device" && onDeviceReady(input.consent, input.sttReady, input.supported)
      ? "wasm"
      : "builtin";
  // "" = never picked: keep the pre-wasm behavior (endpoint when configured).
  const ttsPick: TtsEnginePick =
    input.ttsPick === "" ? (input.hasTtsEndpoint ? "endpoint" : "on-device") : input.ttsPick;
  let tts: TtsEngineId = "builtin";
  if (ttsPick === "endpoint") {
    tts = input.hasTtsEndpoint ? "endpoint" : "builtin";
  } else if (
    ttsPick === "on-device" &&
    onDeviceReady(input.consent, input.ttsReady, input.supported)
  ) {
    tts = "wasm";
  } else if (input.hasTtsEndpoint && ttsPick === "on-device") {
    // on-device picked but not ready: a configured endpoint is a better
    // interim voice than speechSynthesis.
    tts = "endpoint";
  }
  return { stt, tts };
}

/**
 * Resolve engines from live stores + the model cache. Async because the
 * installed check touches CacheStorage; cache misses or a missing storage
 * api degrade to builtin, never throw.
 */
export async function resolveInstalledVoiceEngines(): Promise<ResolvedVoiceEngines> {
  // the runtime asset root (localStorage override) may serve a different
  // manifest version than the baked one — but only fetch it when wasm is
  // even reachable: an unconsented session must not hit the network here
  const consent = $voiceModelsConsent.get();
  const manifest =
    consent === "granted"
      ? await loadVoiceModelManifest().catch(() => DEFAULT_VOICE_MODEL_MANIFEST)
      : DEFAULT_VOICE_MODEL_MANIFEST;
  const installed = await voiceModelBytesInstalled(manifest).catch(() => ({
    stt: false,
    tts: false,
  }));
  return resolveVoiceEngines({
    sttPick: $voiceSttEngine.get(),
    ttsPick: $voiceTtsEngine.get(),
    consent: $voiceModelsConsent.get(),
    sttReady: installed.stt,
    ttsReady: installed.tts,
    supported: wasmVoiceSupported(),
    hasTtsEndpoint: $providerProfile.get()?.tts !== undefined,
  });
}
