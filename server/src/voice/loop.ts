import * as v from "valibot";
import { VOICE_TOOLS, buildPrompt, cutSentences, describeWhiteboardSnapshot } from "@di/shared";
import type {
  Config,
  SessionContext,
  Turn,
  TurnMetrics,
  UpdateQuestionArgs,
  VoiceServerMessage,
} from "@di/shared";
import {
  AUDIO_HEADER_BYTES,
  CAPTURE_SAMPLE_RATE,
  TTS_SAMPLE_RATE,
  VoiceClientMessageSchema,
} from "@di/shared/voice";
import type { Db } from "../store/db";
import { WavBuffer } from "./stt/wav.ts";
import { WhisperStt } from "./stt/whisper-stt.ts";
import { StreamingWhisperStt } from "./stt/streaming-stt.ts";
import type { StreamingSttPort } from "./stt/streaming-stt.ts";
import { PocketTts } from "./tts/pocket-tts.ts";
import { OpenAiChatClient } from "./llm.ts";
import type { LlmMessage, LlmResult, ToolDef } from "./llm.ts";

/** Injectable voice pipeline pieces (tests stub these). */
export interface VoiceStt {
  transcribePcm(pcm: Uint8Array, opts?: { signal?: AbortSignal }): Promise<string>;
}
export interface VoiceTts {
  synthesizeToPcm(text: string, opts?: { signal?: AbortSignal }): Promise<Uint8Array>;
}
export interface VoiceLlm {
  chat(
    messages: LlmMessage[],
    tools?: readonly ToolDef[],
    opts?: { signal?: AbortSignal },
  ): Promise<LlmResult>;
  /** Streaming variant for pipelined sentence TTS; falls back to chat() if absent. */
  streamChat?(
    messages: LlmMessage[],
    tools?: readonly ToolDef[],
    opts?: {
      signal?: AbortSignal;
      onFirstToken?: () => void;
      onText?: (delta: string) => void;
    },
  ): Promise<LlmResult>;
}

export interface VoiceLoopDeps {
  sessionId: string;
  config: Config;
  db: Db;
  send: (msg: VoiceServerMessage) => void;
  sendBinary: (data: Uint8Array) => void;
  stt?: VoiceStt;
  tts?: VoiceTts;
  llm?: VoiceLlm;
  /** Streaming STT stub for tests when config.stt.mode is "streaming". */
  streamingStt?: StreamingSttPort;
}

/** 20ms of PCM16 mono at 24k = 480 samples = 960 bytes. */
const TTS_CHUNK_BYTES = (TTS_SAMPLE_RATE * 2 * 20) / 1000;
const MAX_TOOL_OUTPUT = 4000;

/**
 * Per-connection voice loop: accumulate streamed PCM frames, transcribe per
 * utterance (client VAD delimits), run one LLM turn, persist turns/events,
 * synthesize speech and stream it back as framed PCM chunks. All in-process;
 * replaces the former @livekit/agents worker.
 */
export class VoiceLoop {
  private readonly sessionId: string;
  private readonly config: Config;
  private readonly db: Db;
  private readonly send: (msg: VoiceServerMessage) => void;
  private readonly sendBinary: (data: Uint8Array) => void;
  private readonly stt: VoiceStt;
  private readonly tts: VoiceTts;
  private readonly llm: VoiceLlm;
  /** Set when config.stt.mode is "streaming": audio is fed incrementally. */
  private readonly streamingStt: StreamingSttPort | undefined;

  private buffer = new WavBuffer(CAPTURE_SAMPLE_RATE, 1);
  /** When the current utterance's first audio frame arrived (VAD start proxy). */
  private firstFrameAt: number | undefined;
  private muted = false;
  private abort: AbortController | undefined;
  private ctx: SessionContext = { mode: "interview" };
  private history: LlmMessage[] = [];
  /** Serializes turns so concurrent utterances keep monotonically increasing seqs. */
  private turnLock = Promise.resolve();
  private closed = false;

  constructor(deps: VoiceLoopDeps) {
    this.sessionId = deps.sessionId;
    this.config = deps.config;
    this.db = deps.db;
    this.send = deps.send;
    this.sendBinary = deps.sendBinary;
    const events = {
      postEvent: (sid: string, type: string, payload?: unknown) =>
        this.postEvent(sid, type, payload),
    };
    this.stt =
      deps.stt ??
      new WhisperStt({
        baseUrl: this.config.stt.base_url,
        apiKey: this.config.stt.api_key,
        model: this.config.stt.model,
        events,
        sessionId: this.sessionId,
      });
    this.tts =
      deps.tts ??
      new PocketTts({
        baseUrl: this.config.tts.base_url,
        apiKey: this.config.tts.api_key,
        model: this.config.tts.model,
        voice: this.config.tts.voice,
        events,
        sessionId: this.sessionId,
      });
    this.llm =
      deps.llm ??
      new OpenAiChatClient({
        baseUrl: this.config.llm.base_url,
        apiKey: this.config.llm.api_key,
        model: this.config.llm.model,
        flavor: this.config.llm.flavor,
        events,
        sessionId: this.sessionId,
      });
    if (this.config.stt.mode === "streaming") {
      this.streamingStt =
        deps.streamingStt ??
        new StreamingWhisperStt({
          baseUrl: this.config.stt.base_url,
          apiKey: this.config.stt.api_key,
          model: this.config.stt.model,
          events,
          sessionId: this.sessionId,
        });
    }
  }

  /** Call on WS connection open: binds session context and emits agent.started. */
  async start(): Promise<void> {
    const session = await this.db
      .selectFrom("sessions")
      .selectAll()
      .where("id", "=", this.sessionId)
      .executeTakeFirst();
    this.ctx = {
      mode: session?.mode ?? "interview",
      title: session?.title,
      plan: session?.plan ?? undefined,
    };
    await this.postEvent(this.sessionId, "agent.started", { transport: "ws" });
  }

  /** Handle one client WS message (already parsed) or a raw binary audio frame. */
  async handleMessage(
    msg: v.InferOutput<typeof VoiceClientMessageSchema> | { t: "binary"; data: Uint8Array },
  ): Promise<void> {
    if (this.closed) return;
    if (msg.t === "binary") {
      if (this.muted) return;
      // Strip the 4-byte BE seq header; payload is PCM16LE mono 16k.
      const pcm =
        msg.data.byteLength > AUDIO_HEADER_BYTES
          ? msg.data.subarray(AUDIO_HEADER_BYTES)
          : new Uint8Array(0);
      this.trackFrame(pcm);
      this.buffer.pushBytes(pcm);
      void this.streamingStt
        ?.feed(pcm)
        .catch((err) => console.warn(`[voice] stt feed failed: ${err}`));
      return;
    }
    if (msg.t === "audio") {
      if (this.muted) return;
      const pcm = new Uint8Array(Buffer.from(msg.pcm, "base64"));
      this.trackFrame(pcm);
      this.buffer.pushBytes(pcm);
      void this.streamingStt
        ?.feed(pcm)
        .catch((err) => console.warn(`[voice] stt feed failed: ${err}`));
      return;
    }
    if (msg.t === "mute") {
      this.muted = msg.muted;
      if (msg.muted) this.buffer.clear();
      return;
    }
    if (msg.t === "interrupt") {
      this.abort?.abort();
      this.abort = undefined;
      this.send({ t: "agent_speaking", on: false });
      return;
    }
    if (msg.t === "utterance_end") {
      await this.postEvent(this.sessionId, "vad.speech_ended").catch(() => undefined);
      const t0 = Date.now();
      const vadMs = this.firstFrameAt === undefined ? 0 : t0 - this.firstFrameAt;
      this.firstFrameAt = undefined;
      const pcm = this.buffer.toPcm();
      this.buffer.clear();
      if (pcm.byteLength === 0 && this.streamingStt === undefined) return;
      // Serialize: seq assignment and history mutation must not interleave.
      this.turnLock = this.turnLock
        .then(() => this.runTurn(pcm, t0, vadMs))
        .catch((err) => {
          console.error(`[voice] turn failed: ${err}`);
          this.send({
            t: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        });
      await this.turnLock;
    }
  }

  /** Abort in-flight work and mark the loop dead (WS close). */
  close(): void {
    this.closed = true;
    this.abort?.abort();
    this.abort = undefined;
    this.buffer.clear();
  }

  private async runTurn(pcm: Uint8Array, t0: number, vadMs: number): Promise<void> {
    if (this.closed) return;
    this.abort = new AbortController();
    const { signal } = this.abort;
    const metrics: TurnMetrics = { vad_ms: vadMs, total_ms: 0 };
    try {
      const sttStart = Date.now();
      const text = (
        this.streamingStt !== undefined
          ? await this.streamingStt.finish({ signal })
          : await this.stt.transcribePcm(pcm, { signal })
      ).trim();
      if (text === "") return;
      metrics.stt_ms = Date.now() - sttStart;

      const userTurn = await this.persistTurn("user", text);
      this.send({ t: "user_transcript", turn: userTurn });
      this.history.push({ role: "user", content: text });

      if (this.llm.streamChat) {
        await this.runStreamingSpeechTurn(signal, metrics);
        return;
      }
      const reply = await this.runLlmTurn(signal, metrics);

      const agentTurn = await this.persistTurn("agent", reply.content);
      this.history.push({ role: "assistant", content: reply.content });
      this.send({ t: "agent_transcript", turn: agentTurn });

      if (reply.content.trim() === "") return;
      await this.streamSpeech(reply.content, signal, metrics);
    } catch (err) {
      if (err instanceof Error && (err.name === "AbortError" || String(err).includes("abort")))
        return;
      throw err;
    } finally {
      metrics.total_ms = Date.now() - t0;
      if (!signal.aborted) {
        this.send({ t: "metrics", metrics });
        this.postEvent(this.sessionId, "turn.metrics", metrics).catch(() => undefined);
      }
      if (this.abort?.signal === signal) this.abort = undefined;
    }
  }

  /** First frame of a fresh buffer marks the utterance's VAD start. */
  private trackFrame(pcm: Uint8Array): void {
    if (this.firstFrameAt === undefined && pcm.byteLength > 0) this.firstFrameAt = Date.now();
  }

  /** One LLM round-trip, executing tool calls until a plain reply comes back. */
  private async runLlmTurn(
    signal: AbortSignal,
    metrics?: TurnMetrics,
  ): Promise<{ content: string }> {
    const messages: LlmMessage[] = [
      { role: "system", content: buildPrompt(this.ctx) },
      ...this.history,
    ];
    const llmStart = Date.now();
    for (let hop = 0; hop < 4; hop++) {
      const result = await this.llm.chat(messages, VOICE_TOOLS, { signal });
      if (metrics && metrics.llm_ttft_ms === undefined) metrics.llm_ttft_ms = Date.now() - llmStart;
      if (result.toolCalls.length === 0) return { content: result.content };
      const toolResults: { name: string; output: string }[] = [];
      for (const call of result.toolCalls) {
        toolResults.push({
          name: call.name,
          output: await this.executeTool(call.name, call.args),
        });
      }
      messages.push({
        role: "assistant",
        content: result.content,
        tool_calls: result.toolCalls.map((c, i) => ({
          id: `call_${hop}_${i}`,
          name: c.name,
          arguments: JSON.stringify(c.args),
        })),
      });
      for (const [i, tr] of toolResults.entries()) {
        messages.push({
          role: "tool",
          content: tr.output,
          tool_call_id: `call_${hop}_${i}`,
        });
      }
    }
    return { content: "" };
  }

  /**
   * Streaming turn: pipes LLM text deltas through the shared sentence cutter
   * into pipelined per-sentence TTS, so synthesis of sentence N+1 overlaps
   * with sending sentence N's audio. The agent turn is persisted with the
   * full reply once the stream completes. Tool-call hops drop any streamed
   * provisional speech and retry buffered (tools need the full result).
   */
  private async runStreamingSpeechTurn(signal: AbortSignal, metrics?: TurnMetrics): Promise<void> {
    const messages: LlmMessage[] = [
      { role: "system", content: buildPrompt(this.ctx) },
      ...this.history,
    ];
    for (let hop = 0; hop < 4; hop++) {
      const llmStart = Date.now();
      const pipe = new SentenceSpeechPipeline({
        tts: this.tts,
        send: this.send.bind(this),
        sendBinary: this.sendBinary.bind(this),
        signal,
        metrics,
      });
      const result = await this.llm.streamChat!(messages, VOICE_TOOLS, {
        signal,
        onFirstToken: () => {
          if (metrics && metrics.llm_ttft_ms === undefined)
            metrics.llm_ttft_ms = Date.now() - llmStart;
        },
        onText: (delta) => pipe.push(delta),
      });
      if (result.toolCalls.length === 0) {
        pipe.flush();
        try {
          await pipe.drain();
        } finally {
          pipe.finishSpeaking();
        }
        if (result.content.trim() === "") return;
        const agentTurn = await this.persistTurn("agent", result.content);
        this.history.push({ role: "assistant", content: result.content });
        this.send({ t: "agent_transcript", turn: agentTurn });
        return;
      }
      // Tool hop: text streamed alongside tool calls is provisional; drop it.
      pipe.abandon();
      const toolResults: { name: string; output: string }[] = [];
      for (const call of result.toolCalls) {
        toolResults.push({
          name: call.name,
          output: await this.executeTool(call.name, call.args),
        });
      }
      messages.push({
        role: "assistant",
        content: result.content,
        tool_calls: result.toolCalls.map((c, i) => ({
          id: `call_${hop}_${i}`,
          name: c.name,
          arguments: JSON.stringify(c.args),
        })),
      });
      for (const [i, tr] of toolResults.entries()) {
        messages.push({
          role: "tool",
          content: tr.output,
          tool_call_id: `call_${hop}_${i}`,
        });
      }
    }
  }

  private async executeTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (name === "update_question") {
      const q = args as unknown as UpdateQuestionArgs;
      this.ctx.currentQuestion = q.question;
      if (q.hints) this.ctx.hints = q.hints;
      await this.postEvent(this.sessionId, "question.updated", {
        question: q.question,
        hints: q.hints ?? [],
      });
      return JSON.stringify({ ok: true, question: q.question });
    }
    if (name === "read_editor" || name === "read_whiteboard") {
      const state = await this.readToolState();
      if (name === "read_editor") {
        await this.postEvent(this.sessionId, "tool.read_editor", {
          length: state.editor.length,
        });
        return JSON.stringify({ text: truncate(state.editor) });
      }
      await this.postEvent(this.sessionId, "tool.read_whiteboard", {
        length: state.whiteboard.length,
      });
      return JSON.stringify({
        text: truncate(describeWhiteboardSnapshot(state.whiteboard)),
      });
    }
    return JSON.stringify({ error: `unknown tool: ${name}` });
  }

  private async streamSpeech(
    text: string,
    signal: AbortSignal,
    metrics?: TurnMetrics,
  ): Promise<void> {
    this.send({ t: "agent_speaking", on: true });
    try {
      const pcm = await this.tts.synthesizeToPcm(text, { signal });
      for (let off = 0, seq = 0; off < pcm.length; off += TTS_CHUNK_BYTES, seq++) {
        if (off === 0 && metrics && metrics.first_audio_ms === undefined)
          metrics.first_audio_ms = Date.now();
        const chunk = pcm.subarray(off, off + TTS_CHUNK_BYTES);
        const final = off + TTS_CHUNK_BYTES >= pcm.length;
        const frame = new Uint8Array(AUDIO_HEADER_BYTES + chunk.length);
        new DataView(frame.buffer).setUint32(0, seq, false); // BE seq
        frame.set(chunk, AUDIO_HEADER_BYTES);
        this.sendBinary(frame);
        // JSON fallback carries the same chunk so b64-only clients still play.
        this.send({
          t: "tts",
          seq,
          pcm: Buffer.from(chunk).toString("base64"),
          final,
        });
      }
    } finally {
      this.send({ t: "agent_speaking", on: false });
    }
  }

  /** Same sequencing rule as POST /v1/sessions/:id/turns: max seq + 1. */
  private async persistTurn(speaker: "user" | "agent", text: string): Promise<Turn> {
    const { max_seq } = await this.db
      .selectFrom("turns")
      .select((eb) => eb.fn.coalesce(eb.fn.max("seq"), eb.lit(-1)).as("max_seq"))
      .where("session_id", "=", this.sessionId)
      .executeTakeFirstOrThrow();
    const turn: Turn = {
      id: crypto.randomUUID(),
      session_id: this.sessionId,
      seq: Number(max_seq) + 1,
      speaker,
      text,
      created_at: new Date().toISOString(),
      source: "voice",
    };
    await this.db.insertInto("turns").values(turn).execute();
    return turn;
  }

  private async readToolState(): Promise<{
    editor: string;
    whiteboard: string;
  }> {
    const row = await this.db
      .selectFrom("tool_state")
      .selectAll()
      .where("id", "=", this.sessionId)
      .executeTakeFirst();
    return { editor: row?.editor ?? "", whiteboard: row?.whiteboard ?? "" };
  }

  /** In-process event write (replaces the worker's HTTP postEvent round-trip). */
  private async postEvent(sessionId: string, type: string, payload?: unknown): Promise<void> {
    await this.db
      .insertInto("events")
      .values({
        session_id: sessionId,
        type,
        payload: payload === undefined ? null : JSON.stringify(payload),
        at: new Date().toISOString(),
      })
      .execute();
  }
}

function truncate(text: string, max = MAX_TOOL_OUTPUT): string {
  return text.length <= max ? text : `${text.slice(0, max)}… [truncated]`;
}

/**
 * Pipes streamed LLM text into pipelined per-sentence TTS. Each completed
 * sentence is synthesized and its chunks are sent by a chained promise, so
 * sentence N+1 synthesis starts while sentence N's audio is still being sent
 * while chunk ordering (monotonic seq) is preserved. `agent_speaking on`
 * precedes the first tts chunk; `off` is sent via finishSpeaking().
 */
class SentenceSpeechPipeline {
  private pending = "";
  private seq = 0;
  private speaking = false;
  private done = false;
  /** Tail of the send chain: all synthesis/sends are appended behind this. */
  private tail: Promise<void> = Promise.resolve();
  /** Last enqueued sentence: its final chunk carries final: true. */
  private lastSentence = "";
  private readonly opts: {
    tts: VoiceTts;
    send: (msg: VoiceServerMessage) => void;
    sendBinary: (data: Uint8Array) => void;
    signal: AbortSignal;
    metrics?: TurnMetrics;
  };

  constructor(opts: {
    tts: VoiceTts;
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
    this.lastSentence = sentence;
  }

  private async speakSentence(sentence: string): Promise<void> {
    if (this.opts.signal.aborted) return;
    const pcm = await this.opts.tts.synthesizeToPcm(sentence, {
      signal: this.opts.signal,
    });
    for (let off = 0; off < pcm.length; off += TTS_CHUNK_BYTES) {
      if (this.opts.signal.aborted) return;
      if (this.opts.metrics && this.opts.metrics.first_audio_ms === undefined) {
        this.opts.metrics.first_audio_ms = Date.now();
      }
      const chunk = pcm.subarray(off, off + TTS_CHUNK_BYTES);
      const final =
        off + TTS_CHUNK_BYTES >= pcm.length && this.done && sentence === this.lastSentence;
      this.sendChunk(chunk, final);
    }
  }

  private sendChunk(chunk: Uint8Array, final: boolean): void {
    const seq = this.seq++;
    const frame = new Uint8Array(AUDIO_HEADER_BYTES + chunk.length);
    new DataView(frame.buffer).setUint32(0, seq, false); // BE seq
    frame.set(chunk, AUDIO_HEADER_BYTES);
    this.opts.sendBinary(frame);
    // JSON fallback carries the same chunk so b64-only clients still play.
    this.opts.send({
      t: "tts",
      seq,
      pcm: Buffer.from(chunk).toString("base64"),
      final,
    });
  }
}
