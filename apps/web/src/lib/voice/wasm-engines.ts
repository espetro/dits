import type { SttEngine, SttEngineCallbacks, TtsEngine } from "./engines";
import { readVoiceModelFile } from "./models";

/**
 * On-device engine stubs (phase b): the interfaces, model-file plumbing and
 * readiness checks land here; the actual sherpa-onnx/kittentts workers land
 * in phases c/d. Constructing one validates that the cached model bytes are
 * present so the driver fallback is honest instead of optimistic.
 */

export class WasmSttNotReadyError extends Error {
  constructor() {
    super("wasm stt engine not available");
  }
}

export class WasmTtsNotReadyError extends Error {
  constructor() {
    super("wasm tts engine not available");
  }
}

export class WasmStt implements SttEngine {
  /** resolves when the cached stt model files are verified present */
  async prepare(): Promise<void> {
    const model = await readVoiceModelFile("stt", "stt/model.onnx");
    const tokens = await readVoiceModelFile("stt", "stt/tokens.txt");
    if (!model || !tokens) throw new WasmSttNotReadyError();
  }

  async start(_opts: SttEngineCallbacks): Promise<void> {
    await this.prepare();
    throw new WasmSttNotReadyError();
  }

  feed(_frame: Float32Array): void {
    // stub: the sherpa-onnx worker lands in phase d
  }

  async stop(): Promise<void> {}
}

export class WasmTts implements TtsEngine {
  async prepare(): Promise<void> {
    const model = await readVoiceModelFile("tts", "tts/model.onnx");
    const voices = await readVoiceModelFile("tts", "tts/voices.npz");
    if (!model || !voices) throw new WasmTtsNotReadyError();
  }

  async speak(_sentence: string): Promise<Float32Array> {
    await this.prepare();
    throw new WasmTtsNotReadyError();
  }

  dispose(): void {}
}
