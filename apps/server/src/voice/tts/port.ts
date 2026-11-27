/** Buffered text-to-speech port: text in, PCM16LE mono 24k bytes out. */
export interface TtsPort {
  synthesizeToPcm(text: string, opts?: { signal?: AbortSignal }): Promise<Uint8Array>;
}
