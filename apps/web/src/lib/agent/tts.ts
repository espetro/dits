import { TTS_SAMPLE_RATE } from "@di/shared";
import type { TtsEndpoint } from "@di/shared";

/**
 * Client-only TTS: POST ${baseUrl}/v1/audio/speech (OpenAI-compatible) and
 * decode the WAV to mono PCM16 at TTS_SAMPLE_RATE (24k) for PcmPlayer.
 */

export interface PcmAudio {
  pcm: Uint8Array;
  sampleRate: number;
}

/** Parse a RIFF/WAVE buffer: supports 16-bit PCM mono/stereo. */
export function decodeWav(bytes: Uint8Array): {
  pcm: Int16Array;
  sampleRate: number;
  channels: number;
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (off: number, len: number) => String.fromCharCode(...bytes.subarray(off, off + len));
  if (bytes.byteLength < 44 || tag(0, 4) !== "RIFF" || tag(8, 4) !== "WAVE") {
    throw new Error("not a wav buffer");
  }
  let off = 12;
  let channels = 1;
  let sampleRate = 44100;
  let bits = 16;
  let data: Int16Array | null = null;
  while (off + 8 <= bytes.byteLength) {
    const id = tag(off, 4);
    const size = view.getUint32(off + 4, true);
    const body = off + 8;
    if (id === "fmt ") {
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
    } else if (id === "data" && bits === 16) {
      const count = Math.min(size, bytes.byteLength - body) >> 1;
      data = new Int16Array(count);
      for (let i = 0; i < count; i++) data[i] = view.getInt16(body + i * 2, true);
    }
    off = body + size + (size % 2);
  }
  if (!data) throw new Error("no 16-bit pcm data chunk in wav");
  return { pcm: data, sampleRate, channels };
}

/** Linear resample Int16 mono to the target rate. */
export function resamplePcm16(pcm: Int16Array, from: number, to: number): Int16Array {
  if (from === to) return pcm;
  const out = new Int16Array(Math.round(pcm.length * (to / from)));
  for (let i = 0; i < out.length; i++) {
    const src = (i * from) / to;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, pcm.length - 1);
    const frac = src - i0;
    out[i] = Math.round(pcm[i0]! + (pcm[i1]! - pcm[i0]!) * frac);
  }
  return out;
}

/** Downmix N channels to mono. */
function toMono(pcm: Int16Array, channels: number): Int16Array {
  if (channels === 1) return pcm;
  const frames = Math.floor(pcm.length / channels);
  const out = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += pcm[i * channels + c]!;
    out[i] = Math.round(sum / channels);
  }
  return out;
}

export async function synthesizeSpeech(
  tts: TtsEndpoint,
  text: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array> {
  const base = tts.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  const res = await fetchImpl(`${base}/v1/audio/speech`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${tts.apiKey}`,
    },
    body: JSON.stringify({
      model: tts.model || "tts-1",
      ...(tts.voice ? { voice: tts.voice } : {}),
      input: text,
      response_format: "wav",
    }),
    signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`tts failed: ${res.status} ${body}`);
  }
  const wav = new Uint8Array(await res.arrayBuffer());
  const { pcm, sampleRate, channels } = decodeWav(wav);
  const mono = toMono(pcm, channels);
  const target = resamplePcm16(mono, sampleRate, TTS_SAMPLE_RATE);
  return new Uint8Array(target.buffer, target.byteOffset, target.byteLength);
}
