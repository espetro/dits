function writeHeader(view: DataView, bytes: Uint8Array, samples: number, sampleRate: number): void {
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // pcm chunk size
  view.setUint16(20, 1, true); // pcm
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits
  writeStr(36, "data");
  view.setUint32(40, samples * 2, true);
}

/** Encode 16kHz mono Float32 frames into a RIFF/WAVE pcm16 buffer. */
export function encodeWav(frames: Float32Array[], sampleRate = 16_000): Uint8Array {
  let total = 0;
  for (const f of frames) total += f.length;
  const bytes = new Uint8Array(44 + total * 2);
  const view = new DataView(bytes.buffer);
  writeHeader(view, bytes, total, sampleRate);
  let off = 44;
  for (const frame of frames) {
    for (const s of frame) {
      const clamped = Math.max(-1, Math.min(1, s));
      view.setInt16(off, Math.round(clamped * 32767), true);
      off += 2;
    }
  }
  return bytes;
}

/** Encode mono Int16 samples into a RIFF/WAVE pcm16 buffer. */
export function encodeWavPcm16(pcm: Int16Array, sampleRate = 24_000): Uint8Array {
  const bytes = new Uint8Array(44 + pcm.length * 2);
  const view = new DataView(bytes.buffer);
  writeHeader(view, bytes, pcm.length, sampleRate);
  let off = 44;
  for (const s of pcm) {
    view.setInt16(off, s, true);
    off += 2;
  }
  return bytes;
}
