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
