/**
 * tts slice public entry. Callers import only from here: the engine port,
 * the endpoint synth factory and the settings test helpers. Adapters
 * (openai-compatible endpoint, speechSynthesis, di server layer) stay
 * private; the on-device wasm engine
 * (adapters/wasm.ts) is re-exported here.
 */
import { synthesizeSpeech } from "./adapters/endpoint";
import { testBrowserTts } from "./adapters/browser";
import { testServerTts } from "./adapters/server";

export type { TtsEngine } from "./port";
export { decodeWav, resamplePcm16, synthesizeSpeech } from "./adapters/endpoint";
export type { PcmAudio } from "./adapters/endpoint";
export { testBrowserTts } from "./adapters/browser";
export { testServerTts } from "./adapters/server";
export { WasmTts, WasmTtsNotReadyError } from "./adapters/wasm";

/** Synthesis through the user's BYO endpoint plus the settings tests. */
export interface TtsPort {
  synthesize: typeof synthesizeSpeech;
  testBrowser: typeof testBrowserTts;
  testServer: typeof testServerTts;
}

export function createTtsPort(): TtsPort {
  return { synthesize: synthesizeSpeech, testBrowser: testBrowserTts, testServer: testServerTts };
}
