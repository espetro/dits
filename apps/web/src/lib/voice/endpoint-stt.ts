import type { ProviderEndpoint } from "@di/shared";
import type { SttEngine, SttEngineCallbacks } from "./engines";
import { encodeWav } from "./wav";

/**
 * Cloud stt seam: an OpenAI-compatible /v1/audio/transcriptions endpoint.
 * Buffered-utterance — the vad gate owns utterance boundaries: frames
 * accumulate while speech runs and `flush()` posts one wav per utterance
 * end. Not streaming; interim results stay empty.
 */
export class EndpointStt implements SttEngine {
  private cb: SttEngineCallbacks | null = null;
  private frames: Float32Array[] = [];
  private stopped = false;

  constructor(private readonly endpoint: ProviderEndpoint) {}

  async start(opts: SttEngineCallbacks): Promise<void> {
    this.cb = opts;
    this.stopped = false;
  }

  feed(frame: Float32Array): void {
    // cap the buffer at ~60s of audio: a vad that never fires must not grow
    // unbounded; the oldest silence drains first
    if (this.frames.length > 120) this.frames.shift();
    this.frames.push(frame.slice());
  }

  async flush(): Promise<void> {
    const frames = this.frames;
    this.frames = [];
    if (frames.length === 0 || this.stopped) return;
    const body = new FormData();
    body.set(
      "file",
      new Blob([encodeWav(frames).buffer as ArrayBuffer], { type: "audio/wav" }),
      "audio.wav",
    );
    body.set("model", this.endpoint.model);
    const base = this.endpoint.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
    const res = await fetch(`${base}/v1/audio/transcriptions`, {
      method: "POST",
      headers: this.endpoint.apiKey
        ? { authorization: `Bearer ${this.endpoint.apiKey}` }
        : undefined,
      body,
    });
    if (!res.ok) throw new Error(`stt endpoint ${res.status}`);
    const json: unknown = await res.json();
    const text =
      typeof json === "object" && json !== null && "text" in json && typeof json.text === "string"
        ? json.text
        : "";
    if (text.trim()) this.cb?.onFinal(text.trim());
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.frames = [];
  }
}
