import { encodeWav } from "./wav.ts";
import { providerUrl } from "../provider-url.ts";

/** Minimal in-process event sink the voice loop implements against the db. */
export interface EventSink {
  postEvent(sessionId: string, type: string, payload?: unknown): Promise<void>;
}

export interface WhisperSttOptions {
  baseUrl: string;
  apiKey?: string;
  model: string;
  language?: string;
  fetchImpl?: typeof fetch;
  /** When set, emit stt.request/stt.result/stt.failed pipeline events. */
  events?: EventSink;
  sessionId?: string;
}

/**
 * Buffered STT that wraps PCM16LE mono 16k audio in a WAV container and POSTs
 * it as multipart to an OpenAI-compatible /v1/audio/transcriptions endpoint
 * (field `file`, model from config). Non-streaming by design (v1 mode): the
 * client's VAD delimits utterances, we transcribe each completed one.
 */
export class WhisperStt {
  readonly label = "di_whisper_stt";
  private opts: WhisperSttOptions;

  constructor(opts: WhisperSttOptions) {
    this.opts = opts;
  }

  get model(): string {
    return this.opts.model;
  }

  get provider(): string {
    return "di.whisper";
  }

  /** Wrap PCM16LE mono 16k in a WAV (16k mono) and transcribe it. */
  async transcribePcm(pcm16le: Uint8Array, opts?: { signal?: AbortSignal }): Promise<string> {
    if (pcm16le.byteLength === 0) return "";
    const wav = encodePcmWav(pcm16le);
    return this.transcribeWav(wav, opts?.signal);
  }

  /** POST the WAV to the transcriptions endpoint, return the text. */
  async transcribeWav(wav: Uint8Array, abortSignal?: AbortSignal): Promise<string> {
    const { events, sessionId } = this.opts;
    const bytes = wav.byteLength;
    events
      ?.postEvent(sessionId!, "stt.request", { bytes })
      .catch((err) => console.warn(`[voice] failed to log stt.request: ${err}`));
    const startedAt = Date.now();

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "audio.wav");
    form.append("model", this.opts.model);
    if (this.opts.language) {
      form.append("language", this.opts.language);
    }
    const headers: Record<string, string> = {};
    if (this.opts.apiKey) {
      headers.authorization = `Bearer ${this.opts.apiKey}`;
    }
    const res = await (this.opts.fetchImpl ?? fetch)(
      `${providerUrl(this.opts.baseUrl)}/v1/audio/transcriptions`,
      { method: "POST", headers, body: form, signal: abortSignal },
    );
    const latency_ms = Date.now() - startedAt;
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[voice] whisper stt failed: ${res.status} ${body}`);
      events
        ?.postEvent(sessionId!, "stt.failed", {
          status: res.status,
          body,
          latency_ms,
        })
        .catch((err) => console.warn(`[voice] failed to log stt.failed: ${err}`));
      throw new Error(`whisper stt failed: ${res.status} ${body}`);
    }
    const json = (await res.json()) as { text?: string };
    const text = json.text ?? "";
    events
      ?.postEvent(sessionId!, "stt.result", {
        text_length: text.length,
        latency_ms,
      })
      .catch((err) => console.warn(`[voice] failed to log stt.result: ${err}`));
    return text;
  }
}

/** Wrap raw PCM16LE mono bytes in a 16k mono WAV container. */
export function encodePcmWav(pcm: Uint8Array): Buffer {
  return encodeWav([pcm], { sampleRate: 16_000, channels: 1 });
}
