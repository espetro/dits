/**
 * WAV encoding/decoding helpers for buffered STT/TTS.
 *
 * Audio arrives over the voice WS as 16-bit linear PCM frames. The
 * OpenAI-compatible /v1/audio/transcriptions endpoint accepts multipart
 * uploads, so we accumulate frames and wrap the concatenated PCM in a minimal
 * RIFF/WAVE container. decodeWav parses containers back for TTS output.
 */

export interface WavOptions {
  sampleRate: number;
  channels: number;
  bitsPerSample?: number;
}

/** Build a 44-byte canonical PCM WAV header. */
export function wavHeader(dataLength: number, opts: WavOptions): Buffer {
  const { sampleRate, channels, bitsPerSample = 16 } = opts;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataLength, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataLength, 40);
  return header;
}

/** Concatenate Int16 PCM chunks into one WAV file buffer. */
export function encodeWav(pcmChunks: Uint8Array[], opts: WavOptions): Buffer {
  const data = Buffer.concat(pcmChunks);
  return Buffer.concat([wavHeader(data.length, opts), data]);
}

/** Parsed PCM WAV: header fields + raw data bytes. */
export interface DecodedWav {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  data: Uint8Array;
}

/**
 * Parse a canonical (44-byte header) PCM WAV. Throws on obviously non-WAV
 * input so callers can surface a provider error instead of playing garbage.
 */
export function decodeWav(wav: Uint8Array): DecodedWav {
  const buf = Buffer.isBuffer(wav) ? wav : Buffer.from(wav);
  if (
    buf.length < 44 ||
    buf.toString("ascii", 0, 4) !== "RIFF" ||
    buf.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("not a WAV buffer");
  }
  const dataLength = buf.readUInt32LE(40);
  return {
    sampleRate: buf.readUInt32LE(24),
    channels: buf.readUInt16LE(22),
    bitsPerSample: buf.readUInt16LE(34),
    data: new Uint8Array(buf.subarray(44, 44 + dataLength)),
  };
}

export interface AudioFrameLike {
  data: Int16Array;
  sampleRate: number;
  numChannels: number;
}

/** Collect frames into PCM chunks, converting interleaved frame data. */
export class WavBuffer {
  readonly sampleRate: number;
  readonly numChannels: number;
  private chunks: Uint8Array[] = [];

  constructor(sampleRate: number, numChannels = 1) {
    this.sampleRate = sampleRate;
    this.numChannels = numChannels;
  }

  pushFrame(frame: AudioFrameLike): void {
    this.chunks.push(
      frame.data.buffer instanceof ArrayBuffer
        ? new Uint8Array(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength)
        : new Uint8Array(frame.data.slice().buffer),
    );
  }

  /** Push raw PCM16LE bytes directly (WS binary frames after seq strip). */
  pushBytes(bytes: Uint8Array): void {
    this.chunks.push(bytes);
  }

  get byteLength(): number {
    return this.chunks.reduce((sum, c) => sum + c.byteLength, 0);
  }

  isEmpty(): boolean {
    return this.byteLength === 0;
  }

  /** Finalize: return the complete WAV buffer. */
  toWav(): Buffer {
    return encodeWav(this.chunks, {
      sampleRate: this.sampleRate,
      channels: this.numChannels,
    });
  }

  /** Concatenated raw PCM bytes (no WAV wrapper). */
  toPcm(): Uint8Array {
    const out = new Uint8Array(this.byteLength);
    let off = 0;
    for (const c of this.chunks) {
      out.set(c, off);
      off += c.byteLength;
    }
    return out;
  }

  clear(): void {
    this.chunks = [];
  }
}

/**
 * Nearest-neighbor resampler for Int16 mono PCM. Quality is fine for speech
 * playback; avoids a full interpolation/SRC dependency.
 */
export function resamplePcm16(pcm: Uint8Array, fromRate: number, toRate: number): Uint8Array {
  if (fromRate === toRate || pcm.length === 0) return pcm;
  const inSamples = Math.floor(pcm.length / 2);
  const outSamples = Math.round((inSamples * toRate) / fromRate);
  const out = new Uint8Array(outSamples * 2);
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < outSamples; i++) {
    const src = Math.min(Math.floor((i * fromRate) / toRate), inSamples - 1);
    outView.setInt16(i * 2, view.getInt16(src * 2, true), true);
  }
  return out;
}
