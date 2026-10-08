import { $voiceModelsConsent, $voiceSttEngine, $voiceTtsEngine } from "../../stores/voice";
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
 *   (Web Speech SpeechRecognition) | "endpoint" (BYO transcriptions api).
 * - tts: "wasm" (KittenTTS worker) | "builtin" (speechSynthesis) |
 *   "endpoint" (BYO /v1/audio/speech via profile.tts).
 *
 * The "server" layer pick is resolved at driver-selection time
 * (lib/voice/index.ts): it only lands here when the server could not take
 * the seam (unreachable, or the other layer forced the browser driver), in
 * which case the seam falls back to the auto chain.
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
  /**
   * Synthesize one sentence as a chunk stream at the engine's native rate;
   * callers start playback on the first chunk. Returning the iterator cancels
   * the remote generator (barge-in).
   */
  speak(sentence: string): AsyncIterable<Float32Array>;
  /** Drop queued-but-not-started utterances (barge-in); in-flight runs finish. */
  cancelPending?(): void;
  dispose(): void;
}

export type SttEngineId = "wasm" | "builtin" | "endpoint";
export type TtsEngineId = "wasm" | "builtin" | "endpoint";

export interface VoiceEngineInput {
  sttPick: string;
  ttsPick: string;
  /** consent store value: "granted" | "declined" | "" */
  consent: string;
  /** model files verified in the cache */
  sttReady: boolean;
  ttsReady: boolean;
  /** wasm + simd usable in this browser */
  supported: boolean;
  /** a BYO tts endpoint is configured (profile.tts) */
  hasTtsEndpoint: boolean;
  /** a BYO stt endpoint is configured (profile.stt) */
  hasSttEndpoint: boolean;
}

export interface ResolvedVoiceEngines {
  stt: SttEngineId;
  tts: TtsEngineId;
}

function onDeviceReady(consent: string, ready: boolean, supported: boolean): boolean {
  return supported && consent === "granted" && ready;
}

/**
 * Effective engines for the browser driver. "" auto and a degraded "server"
 * pick share the auto chain: on-device requires consent + a verified
 * download + wasm support; anything short falls back without a dead voice
 * loop — stt -> builtin; tts -> endpoint when configured, else builtin.
 */
export function resolveVoiceEngines(input: VoiceEngineInput): ResolvedVoiceEngines {
  let stt: SttEngineId = "builtin";
  if (input.sttPick === "cloud") {
    stt = input.hasSttEndpoint ? "endpoint" : "builtin";
  } else if (input.sttPick === "in-browser") {
    stt = "builtin";
  } else if (
    // "wasm", or ""/"server" auto chain (wasm first, builtin fallback)
    onDeviceReady(input.consent, input.sttReady, input.supported)
  ) {
    stt = "wasm";
  }

  let tts: TtsEngineId = "builtin";
  if (input.ttsPick === "cloud") {
    tts = input.hasTtsEndpoint ? "endpoint" : "builtin";
  } else if (input.ttsPick === "in-browser") {
    tts = "builtin";
  } else if (onDeviceReady(input.consent, input.ttsReady, input.supported)) {
    // "wasm", or ""/"server" auto chain (wasm first)
    tts = "wasm";
  } else if ((input.ttsPick === "" || input.ttsPick === "server") && input.hasTtsEndpoint) {
    // auto/degraded pick with a configured endpoint: a better interim voice
    // than speechSynthesis.
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
  const profile = $providerProfile.get();
  return resolveVoiceEngines({
    sttPick: $voiceSttEngine.get(),
    ttsPick: $voiceTtsEngine.get(),
    consent,
    sttReady: installed.stt,
    ttsReady: installed.tts,
    supported: wasmVoiceSupported(),
    hasTtsEndpoint: profile?.tts !== undefined,
    hasSttEndpoint: profile?.stt !== undefined,
  });
}
