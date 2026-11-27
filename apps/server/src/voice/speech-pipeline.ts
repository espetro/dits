import { cutSentences } from "@di/shared";
import type { TurnMetrics, VoiceServerMessage } from "@di/shared";
import { AUDIO_HEADER_BYTES, TTS_SAMPLE_RATE } from "@di/shared/voice";
import { markFirstAudio } from "./metrics.ts";
import type { TtsPort } from "./tts/index.ts";

/** 20ms of PCM16 mono at 24k = 480 samples = 960 bytes. */
const TTS_CHUNK_BYTES = (TTS_SAMPLE_RATE * 2 * 20) / 1000;

/** Frame one PCM chunk for the wire: 4-byte BE seq header + payload. */
function frameChunk(seq: number, chunk: Uint8Array): Uint8Array {
  const frame = new Uint8Array(AUDIO_HEADER_BYTES + chunk.length);
  new DataView(frame.buffer).setUint32(0, seq, false); // BE seq
  frame.set(chunk, AUDIO_HEADER_BYTES);
  return frame;
}

interface SpeechSinks {
  send: (msg: VoiceServerMessage) => void;
  sendBinary: (data: Uint8Array) => void;
}

/**
 * Buffered (non-streaming) speech: synthesize the whole reply, then send it
 * as 20ms framed chunks between agent_speaking on/off.
 */
export async function speakBuffered(
  opts: SpeechSinks & { tts: TtsPort; text: string; signal: AbortSignal; metrics?: TurnMetrics },
): Promise<void> {
  const { tts, text, signal, metrics, send, sendBinary } = opts;
  send({ t: "agent_speaking", on: true });
  try {
    let pcm: Uint8Array;
    try {
      pcm = await tts.synthesizeToPcm(text, { signal });
    } catch (err) {
      // Same degradation as the streaming path: no audio, but the
      // transcript has already been sent and the turn completes.
      send({
        t: "error",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    for (let off = 0, seq = 0; off < pcm.length; off += TTS_CHUNK_BYTES, seq++) {
      if (off === 0 && metrics) markFirstAudio(metrics);
      sendBinary(frameChunk(seq, pcm.subarray(off, off + TTS_CHUNK_BYTES)));
    }
  } finally {
    send({ t: "agent_speaking", on: false });
  }
}

/**
 * Pipes streamed LLM text into pipelined per-sentence TTS. Each completed
 * sentence is synthesized and its chunks are sent by a chained promise, so
 * sentence N+1 synthesis starts while sentence N's audio is still being sent
 * while chunk ordering (monotonic seq) is preserved. `agent_speaking on`
 * precedes the first tts chunk; `off` is sent via finishSpeaking().
 */
export class SentenceSpeechPipeline {
  private pending = "";
  private seq = 0;
  private speaking = false;
  private done = false;
  /** Set when synthesis failed once — later sentences don't retry. */
  private failed = false;
  /** Tail of the send chain: all synthesis/sends are appended behind this. */
  private tail: Promise<void> = Promise.resolve();
  private readonly opts: {
    tts: TtsPort;
    send: (msg: VoiceServerMessage) => void;
    sendBinary: (data: Uint8Array) => void;
    signal: AbortSignal;
    metrics?: TurnMetrics;
  };

  constructor(opts: {
    tts: TtsPort;
    send: (msg: VoiceServerMessage) => void;
    sendBinary: (data: Uint8Array) => void;
    signal: AbortSignal;
    metrics?: TurnMetrics;
  }) {
    this.opts = opts;
  }

  /** Feed one LLM text delta; cut and enqueue complete sentences. */
  push(delta: string): void {
    if (this.done || this.opts.signal.aborted) return;
    this.pending += delta;
    const { sentences, rest } = cutSentences(this.pending);
    this.pending = rest;
    for (const s of sentences) this.enqueue(s);
  }

  /** End-of-stream: flush the remainder as the final sentence. */
  flush(): void {
    if (this.done) return;
    this.done = true;
    const rest = this.pending.trim();
    if (rest !== "") this.enqueue(rest);
  }

  /** Drop any pending speech (e.g. a tool-call hop after streamed text). */
  abandon(): void {
    this.done = true;
    this.pending = "";
    this.finishSpeaking();
  }

  /** Wait for all enqueued synthesis/send work to settle. */
  drain(): Promise<void> {
    return this.tail;
  }

  finishSpeaking(): void {
    if (this.speaking) {
      this.speaking = false;
      this.opts.send({ t: "agent_speaking", on: false });
    }
  }

  private enqueue(sentence: string): void {
    if (this.opts.signal.aborted) return;
    if (!this.speaking) {
      this.speaking = true;
      this.opts.send({ t: "agent_speaking", on: true });
    }
    // Chain behind previous sends; synthesis starts as soon as the chain
    // reaches it, concurrently with LLM stream consumption. Ordering holds
    // because each sentence's sends are appended to the same promise chain.
    const task = this.tail.then(() => this.speakSentence(sentence));
    this.tail = task;
  }

  private async speakSentence(sentence: string): Promise<void> {
    if (this.opts.signal.aborted || this.failed) return;
    let pcm: Uint8Array;
    try {
      pcm = await this.opts.tts.synthesizeToPcm(sentence, {
        signal: this.opts.signal,
      });
    } catch (err) {
      // A tts outage degrades a reply to silent text: stop the pipeline but
      // let the turn finish so the transcript is still persisted and sent.
      this.failed = true;
      this.done = true;
      this.pending = "";
      this.opts.send({
        t: "error",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    for (let off = 0; off < pcm.length; off += TTS_CHUNK_BYTES) {
      if (this.opts.signal.aborted) return;
      if (this.opts.metrics) markFirstAudio(this.opts.metrics);
      const chunk = pcm.subarray(off, off + TTS_CHUNK_BYTES);
      this.sendChunk(chunk);
    }
  }

  private sendChunk(chunk: Uint8Array): void {
    this.opts.sendBinary(frameChunk(this.seq++, chunk));
  }
}
