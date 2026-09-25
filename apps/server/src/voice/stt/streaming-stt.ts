import type { EventSink } from "./whisper-stt.ts";
import { encodePcmWav } from "./whisper-stt.ts";
import { providerUrl } from "../provider-url.ts";

/** Incremental STT port: feed audio frames, finish() closes the utterance. */
export interface StreamingSttPort {
  feed(pcm: Uint8Array, opts?: { signal?: AbortSignal }): Promise<void>;
  finish(opts?: { signal?: AbortSignal }): Promise<string>;
}

export interface StreamingWhisperSttOptions {
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
 * Streaming STT against an OpenAI-compatible endpoint: `feed` forwards raw
 * PCM16LE mono 16k bytes over a duplex ReadableStream request body to
 * `/v1/audio/transcriptions?stream=true` (opened on first feed); the
 * response is read as SSE `data:` lines carrying `{"text":"..."}` deltas.
 * `finish()` closes the request stream and resolves with the accumulated
 * text.
 *
 * Gateways that ignore `?stream=true` (non-SSE or non-ok response) or where
 * the request itself fails are handled by a buffered fallback: everything
 * fed so far is re-POSTed once as a WAV multipart transcription (same shape
 * as WhisperStt). Testable via injected fetchImpl.
 */
export class StreamingWhisperStt implements StreamingSttPort {
  readonly label = "di_whisper_stt_stream";
  private opts: StreamingWhisperSttOptions;
  /** Controller of the open request body stream, if a feed session is live. */
  private controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  /** Resolves with the utterance transcript once the response completes. */
  private textPromise: Promise<string> | undefined;
  /** Everything fed this utterance, kept for the buffered fallback. */
  private fed: Uint8Array[] = [];

  constructor(opts: StreamingWhisperSttOptions) {
    this.opts = opts;
  }

  get model(): string {
    return this.opts.model;
  }

  get provider(): string {
    return "di.whisper.streaming";
  }

  async feed(pcm: Uint8Array, opts?: { signal?: AbortSignal }): Promise<void> {
    if (pcm.byteLength === 0) return;
    const copy = new Uint8Array(pcm);
    this.fed.push(copy);
    if (this.controller === undefined) this.open(copy, opts?.signal);
    else this.controller.enqueue(copy);
  }

  /** Close the utterance and resolve the accumulated transcript. */
  async finish(opts?: { signal?: AbortSignal }): Promise<string> {
    if (this.textPromise === undefined) {
      // No live streaming session (nothing fed): buffered fallback path.
      this.textPromise = this.transcribeBuffered(opts?.signal);
    }
    try {
      this.controller?.close();
    } catch {
      // already closed
    }
    this.controller = undefined;
    const text = await this.textPromise;
    this.textPromise = undefined;
    this.fed = [];
    return text;
  }

  /** Open the duplex streaming request and wire SSE text accumulation. */
  private open(first: Uint8Array, signal?: AbortSignal): void {
    const { events, sessionId } = this.opts;
    const startedAt = Date.now();
    let resolveText!: (text: string) => void;
    this.textPromise = new Promise<string>((resolve) => {
      resolveText = resolve;
    });

    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
        controller.enqueue(first);
      },
    });
    const headers: Record<string, string> = {
      "content-type": "application/octet-stream",
      "x-audio-format": "pcm16le-16k-mono",
    };
    if (this.opts.apiKey) headers.authorization = `Bearer ${this.opts.apiKey}`;

    events
      ?.postEvent(sessionId!, "stt.request", {
        bytes: first.byteLength,
        stream: true,
      })
      .catch((err) => console.warn(`[voice] failed to log stt.request: ${err}`));

    const settleFallback = async (why: string) => {
      console.warn(`[voice] streaming stt fell back to buffered: ${why}`);
      try {
        resolveText(await this.transcribeBuffered(signal));
      } catch (err) {
        resolveText("");
        throw err;
      }
    };

    void (this.opts.fetchImpl ?? fetch)(
      `${providerUrl(this.opts.baseUrl)}/v1/audio/transcriptions?stream=true&model=${encodeURIComponent(this.opts.model)}`,
      {
        method: "POST",
        headers,
        body,
        signal,
        // `duplex` is required by fetch for streaming request bodies but
        // missing from lib.dom.d.ts's RequestInit at this TS lib version.
        duplex: "half",
      } as RequestInit & { duplex: "half" },
    )
      .then(async (res) => {
        if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
          await settleFallback(`non-SSE response (${res.status})`);
          return;
        }
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let text = "";
        const handleLine = (line: string) => {
          if (!line.startsWith("data:")) return;
          const data = line.slice(5).trim();
          if (data === "" || data === "[DONE]") return;
          try {
            const delta = JSON.parse(data) as { text?: string };
            if (typeof delta.text === "string") text += delta.text;
          } catch {
            // ignore malformed deltas
          }
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            handleLine(buf.slice(0, nl).replace(/\r$/, ""));
            buf = buf.slice(nl + 1);
          }
        }
        if (buf.trim() !== "") handleLine(buf.replace(/\r$/, ""));
        events
          ?.postEvent(sessionId!, "stt.result", {
            text_length: text.length,
            latency_ms: Date.now() - startedAt,
            stream: true,
          })
          .catch(() => undefined);
        resolveText(text);
      })
      .catch(async (err: unknown) => {
        await settleFallback(String(err));
      });
  }

  /** One buffered multipart WAV POST of everything fed so far (fallback). */
  private async transcribeBuffered(signal?: AbortSignal): Promise<string> {
    const { events, sessionId } = this.opts;
    const all = this.concatFed();
    if (all.byteLength === 0) return "";
    const wav = encodePcmWav(all);
    const startedAt = Date.now();
    events
      ?.postEvent(sessionId!, "stt.request", {
        bytes: wav.byteLength,
        buffered_fallback: true,
      })
      .catch(() => undefined);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "audio.wav");
    form.append("model", this.opts.model);
    if (this.opts.language) form.append("language", this.opts.language);
    const headers: Record<string, string> = {};
    if (this.opts.apiKey) headers.authorization = `Bearer ${this.opts.apiKey}`;
    const res = await (this.opts.fetchImpl ?? fetch)(
      `${providerUrl(this.opts.baseUrl)}/v1/audio/transcriptions`,
      { method: "POST", headers, body: form, signal },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      events
        ?.postEvent(sessionId!, "stt.failed", {
          status: res.status,
          body,
          latency_ms: Date.now() - startedAt,
        })
        .catch(() => undefined);
      throw new Error(`streaming stt fallback failed: ${res.status} ${body}`);
    }
    const json = (await res.json()) as { text?: string };
    const text = json.text ?? "";
    events
      ?.postEvent(sessionId!, "stt.result", {
        text_length: text.length,
        latency_ms: Date.now() - startedAt,
        buffered_fallback: true,
      })
      .catch(() => undefined);
    return text;
  }

  private concatFed(): Uint8Array {
    const len = this.fed.reduce((s, c) => s + c.byteLength, 0);
    const out = new Uint8Array(len);
    let off = 0;
    for (const c of this.fed) {
      out.set(c, off);
      off += c.byteLength;
    }
    return out;
  }
}
