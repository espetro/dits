import * as v from "valibot";
import { KICKOFF_DELAY_MS, KICKOFF_UTTERANCE, voiceToolsFor } from "@di/shared";
import type { Config, Turn, VoiceServerMessage } from "@di/shared";
import {
  AUDIO_HEADER_BYTES,
  CAPTURE_SAMPLE_RATE,
  VoiceClientMessageSchema,
} from "@di/shared/voice";
import type { Db } from "../store/db";
import { WavBuffer, createSttFromConfig } from "./stt/index.ts";
import type { StreamingSttPort, SttPort } from "./stt/index.ts";
import { createTtsFromConfig } from "./tts/index.ts";
import type { TtsPort } from "./tts/index.ts";
import { createLlmFromConfig } from "./llm/index.ts";
import type { LlmMessage, LlmPort } from "./llm/index.ts";
import { finishTurnMetrics, startTurnMetrics } from "./metrics.ts";
import { MAX_TOOL_OUTPUT, ToolExecutor, parseToolsColumn } from "./tools.ts";
import { TurnRunner } from "./turn-runner.ts";

/** Injectable voice pipeline pieces (tests stub these); aliases of the slice ports. */
export type VoiceStt = SttPort;
export type VoiceTts = TtsPort;
export type VoiceLlm = LlmPort;

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
  /** Delay before the synthetic kickoff turn fires; <= 0 disables it. */
  kickoffMs?: number;
}

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
  private readonly runner: TurnRunner;
  /** Serializes turns so concurrent utterances keep monotonically increasing seqs. */
  private turnLock = Promise.resolve();
  private closed = false;
  private kickoffTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly kickoffMs: number;

  constructor(deps: VoiceLoopDeps) {
    this.sessionId = deps.sessionId;
    this.config = deps.config;
    this.db = deps.db;
    this.send = deps.send;
    this.sendBinary = deps.sendBinary;
    this.kickoffMs = deps.kickoffMs ?? deps.config.voice?.kickoff_ms ?? KICKOFF_DELAY_MS;
    const events = {
      postEvent: (sid: string, type: string, payload?: unknown) =>
        this.postEvent(sid, type, payload),
    };
    const factoryOpts = { events, sessionId: this.sessionId };
    const { stt, streamingStt } = createSttFromConfig(this.config, {
      ...factoryOpts,
      stt: deps.stt,
      streamingStt: deps.streamingStt,
    });
    this.stt = stt;
    this.streamingStt = streamingStt;
    this.tts = deps.tts ?? createTtsFromConfig(this.config, factoryOpts);
    this.llm = deps.llm ?? createLlmFromConfig(this.config.llm, factoryOpts);
    this.runner = new TurnRunner({
      llm: this.llm,
      tts: this.tts,
      tools: new ToolExecutor({
        sessionId: this.sessionId,
        db: this.db,
        send: this.send,
        postEvent: events.postEvent,
        getCtx: () => this.runner.ctx,
        maxToolOutput: deps.config.voice?.max_tool_output ?? MAX_TOOL_OUTPUT,
      }),
      send: this.send,
      sendBinary: this.sendBinary,
      persistTurn: (speaker, text, source) => this.persistTurn(speaker, text, source),
    });
  }

  /** Call on WS connection open: binds session context and emits agent.started. */
  async start(): Promise<void> {
    const session = await this.db
      .selectFrom("sessions")
      .selectAll()
      .where("id", "=", this.sessionId)
      .executeTakeFirst();
    this.runner.ctx = {
      mode: session?.mode ?? "interview",
      title: session?.title,
      plan: session?.plan ?? undefined,
      prompt: session?.prompt ?? undefined,
    };
    this.runner.voiceTools = voiceToolsFor(parseToolsColumn(session?.tools));
    await this.postEvent(this.sessionId, "agent.started", { transport: "ws" });
    // Seed in-memory history from persisted turns so a reconnecting or
    // text-first session keeps context (REST-posted turns included).
    const priorTurns = await this.db
      .selectFrom("turns")
      .select(["speaker", "text"])
      .where("session_id", "=", this.sessionId)
      .orderBy("seq")
      .execute();
    this.runner.history.push(
      ...priorTurns.map((t): LlmMessage => ({
        role: t.speaker === "user" ? "user" : "assistant",
        content: t.text,
      })),
    );
    this.armKickoff();
  }

  /**
   * Nobody spoke first: after `kickoffMs` with no user input, run a synthetic
   * user turn so the agent greets and asks the first question (parity with
   * the browser driver's kickoff timer). Skipped when the session already
   * has turns or once real input arrives.
   */
  private armKickoff(): void {
    if (this.kickoffMs <= 0 || this.runner.history.some((m) => m.role !== "system")) return;
    this.kickoffTimer = setTimeout(() => {
      this.kickoffTimer = undefined;
      this.turnLock = this.turnLock
        .then(async () => {
          // a REST-posted turn during the kickoff window doesn't reach
          // handleMessage/cancelKickoff, so re-check persisted turns at
          // fire time rather than double-greeting.
          const { turns } = await this.db
            .selectFrom("turns")
            .select((eb) => eb.fn.countAll().as("turns"))
            .where("session_id", "=", this.sessionId)
            .executeTakeFirstOrThrow();
          if (Number(turns) > 0) return;
          await this.postEvent(this.sessionId, "agent.kickoff");
          return this.runTextTurn(KICKOFF_UTTERANCE, "text");
        })
        .catch((err) => {
          console.error(`[voice] kickoff turn failed: ${err}`);
          this.send({
            t: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        });
    }, this.kickoffMs);
    this.kickoffTimer.unref?.();
  }

  private cancelKickoff(): void {
    if (this.kickoffTimer !== undefined) {
      clearTimeout(this.kickoffTimer);
      this.kickoffTimer = undefined;
    }
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
    if (msg.t === "text") {
      this.cancelKickoff();
      this.turnLock = this.turnLock
        .then(() => this.runTextTurn(msg.text.trim(), "text"))
        .catch((err) => {
          console.error(`[voice] text turn failed: ${err}`);
          this.send({
            t: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        });
      await this.turnLock;
      return;
    }
    if (msg.t === "utterance_end") {
      this.cancelKickoff();
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
    this.cancelKickoff();
    this.abort?.abort();
    this.abort = undefined;
    this.buffer.clear();
    // builtin wasm workers live per-loop; remote engines have no dispose
    for (const engine of [this.stt, this.tts]) {
      (engine as { terminate?: () => void }).terminate?.();
    }
  }

  private async runTurn(pcm: Uint8Array, t0: number, vadMs: number): Promise<void> {
    if (this.closed) return;
    this.abort = new AbortController();
    const { signal } = this.abort;
    const metrics = startTurnMetrics(t0, vadMs);
    try {
      const sttStart = Date.now();
      const text = (
        this.streamingStt !== undefined
          ? await this.streamingStt.finish({ signal })
          : await this.stt.transcribePcm(pcm, { signal })
      ).trim();
      if (text === "") return;
      metrics.stt_ms = Date.now() - sttStart;

      await this.runner.runAgentReply(text, "voice", signal, metrics);
    } catch (err) {
      if (err instanceof Error && (err.name === "AbortError" || String(err).includes("abort")))
        return;
      throw err;
    } finally {
      finishTurnMetrics(metrics, t0, signal, {
        send: this.send,
        postEvent: (type, payload) => this.postEvent(this.sessionId, type, payload),
      });
      if (this.abort?.signal === signal) this.abort = undefined;
    }
  }

  /**
   * Turn pipeline once the user text is known (typed composer input or the
   * synthetic kickoff): same persist -> LLM -> speak path as a voice turn,
   * minus STT.
   */
  private async runTextTurn(text: string, source: "voice" | "text"): Promise<void> {
    if (this.closed || text === "") return;
    this.abort = new AbortController();
    const { signal } = this.abort;
    const t0 = Date.now();
    const metrics = startTurnMetrics(t0, 0);
    try {
      await this.runner.runAgentReply(text, source, signal, metrics);
    } catch (err) {
      if (err instanceof Error && (err.name === "AbortError" || String(err).includes("abort")))
        return;
      throw err;
    } finally {
      finishTurnMetrics(metrics, t0, signal, {
        send: this.send,
        postEvent: (type, payload) => this.postEvent(this.sessionId, type, payload),
      });
      if (this.abort?.signal === signal) this.abort = undefined;
    }
  }

  /** First frame of a fresh buffer marks the utterance's VAD start. */
  private trackFrame(pcm: Uint8Array): void {
    if (this.firstFrameAt === undefined && pcm.byteLength > 0) this.firstFrameAt = Date.now();
  }

  /** Same sequencing rule as POST /v1/sessions/:id/turns: max seq + 1. */
  private async persistTurn(
    speaker: "user" | "agent",
    text: string,
    source: "voice" | "text" = "voice",
  ): Promise<Turn> {
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
      source,
    };
    await this.db.insertInto("turns").values(turn).execute();
    await this.postEvent(this.sessionId, "turn.persisted", {
      speaker,
      seq: turn.seq,
      source,
    });
    return turn;
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
