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
