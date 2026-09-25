import type { EventSink } from "../stt/whisper-stt.ts";
import { decodeWav, resamplePcm16 } from "../stt/wav.ts";
import { providerUrl } from "../provider-url.ts";

const SAMPLE_RATE = 24_000;

export interface PocketTtsOptions {
  baseUrl: string;
  apiKey?: string;
  model: string;
  voice: string;
  fetchImpl?: typeof fetch;
  /** When set, emit tts.request/tts.result/tts.failed pipeline events. */
  events?: EventSink;
  sessionId?: string;
}

/**
 * Buffered TTS that POSTs {input, voice, model, response_format:"wav"} JSON to
 * an OpenAI-compatible /v1/audio/speech endpoint and returns the decoded audio
 * as PCM16LE mono 24k bytes.
 *
 * Format choice: WAV, not mp3/pcm. The local pocket-tts stack is fronted by
 * scripts/pocket-shim.ts, whose /v1/audio/speech returns whatever pocket-tts
 * /tts produces — a WAV — and the evals mock provider also returns WAV.
 * Decoding WAV is header parsing we already need (see stt/wav.ts decodeWav);
 * mp3 would pull in a decoder dependency for no local-stack benefit. If a
 * provider returns WAV at a different sample rate, we nearest-neighbor
 * resample to 24k (mock returns 8k, we resample; pass-through at 24k).
 */
export class PocketTts {
  readonly label = "di_pocket_tts";

  constructor(private opts: PocketTtsOptions) {}

  get model(): string {
    return this.opts.model;
  }

  get provider(): string {
    return "di.pocket";
  }

  /** Synthesize text, returning PCM16LE mono 24k bytes. */
  async synthesizeToPcm(text: string, opts?: { signal?: AbortSignal }): Promise<Uint8Array> {
    const wav = await this.fetchSpeechWav(text, opts?.signal);
    const { sampleRate, channels, data } = decodeWav(wav);
    let pcm = data;
    if (channels !== 1) {
      pcm = downmixToMono(pcm, channels);
    }
    return resamplePcm16(pcm, sampleRate, SAMPLE_RATE);
  }

  private async fetchSpeechWav(text: string, signal?: AbortSignal): Promise<Uint8Array> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.opts.apiKey) {
      headers.authorization = `Bearer ${this.opts.apiKey}`;
    }
    const { events, sessionId } = this.opts;
    events
      ?.postEvent(sessionId!, "tts.request", { text_length: text.length })
      .catch((err) => console.warn(`[voice] failed to log tts.request: ${err}`));
    const startedAt = Date.now();
    const res = await (this.opts.fetchImpl ?? fetch)(
      `${providerUrl(this.opts.baseUrl)}/v1/audio/speech`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          input: text,
          voice: this.opts.voice,
          model: this.opts.model,
          response_format: "wav",
        }),
        signal,
      },
    );
    const latency_ms = Date.now() - startedAt;
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      events
        ?.postEvent(sessionId!, "tts.failed", {
          status: res.status,
          body,
          latency_ms,
        })
        .catch((err) => console.warn(`[voice] failed to log tts.failed: ${err}`));
      throw new Error(`pocket tts failed: ${res.status} ${body}`);
    }
    const buffer = new Uint8Array(await res.arrayBuffer());
    events
      ?.postEvent(sessionId!, "tts.result", {
        bytes: buffer.byteLength,
        latency_ms,
      })
      .catch((err) => console.warn(`[voice] failed to log tts.result: ${err}`));
    return buffer;
  }
}

/** Average interleaved multi-channel PCM16 down to mono. */
function downmixToMono(pcm: Uint8Array, channels: number): Uint8Array {
  const frames = Math.floor(pcm.length / 2 / channels);
  const out = new Uint8Array(frames * 2);
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const outView = new DataView(out.buffer);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let ch = 0; ch < channels; ch++) sum += view.getInt16((f * channels + ch) * 2, true);
    outView.setInt16(f * 2, Math.round(sum / channels), true);
  }
  return out;
}
