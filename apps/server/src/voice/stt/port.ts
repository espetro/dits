/** Buffered STT port: one complete utterance (PCM16LE mono 16k) in, text out. */
export interface SttPort {
  transcribePcm(pcm: Uint8Array, opts?: { signal?: AbortSignal }): Promise<string>;
}

/** Incremental STT port: feed audio frames, finish() closes the utterance. */
export interface StreamingSttPort {
  feed(pcm: Uint8Array, opts?: { signal?: AbortSignal }): Promise<void>;
  finish(opts?: { signal?: AbortSignal }): Promise<string>;
}
