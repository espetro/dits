/**
 * sherpa-onnx npm ships no declaration file. We only need the online
 * recognizer surface — declared here structurally compatible with
 * @di/voice-engines' SherpaRecognizer/SherpaStream.
 */
declare module "sherpa-onnx" {
  interface SherpaOnnxStream {
    acceptWaveform(sampleRate: number, samples: Float32Array): void;
    inputFinished(): void;
  }

  interface SherpaOnnxRecognizer {
    createStream(): SherpaOnnxStream;
    isReady(stream: SherpaOnnxStream): boolean;
    decode(stream: SherpaOnnxStream): void;
    isEndpoint(stream: SherpaOnnxStream): boolean;
    reset(stream: SherpaOnnxStream): void;
    getResult(stream: SherpaOnnxStream): { text?: string };
  }

  interface SherpaOnnxOnlineConfig {
    featConfig: { sampleRate: number; featureDim: number };
    modelConfig: {
      zipformer2Ctc?: { model: string };
      tokens: string;
      numThreads: number;
      provider: string;
      debug: number;
    };
  }

  const sherpa: {
    createOnlineRecognizer(config: SherpaOnnxOnlineConfig): SherpaOnnxRecognizer;
  };
  export default sherpa;
}
