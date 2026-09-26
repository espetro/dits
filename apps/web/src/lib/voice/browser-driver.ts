import { KICKOFF_DELAY_MS, KICKOFF_UTTERANCE, cutSentences } from "@di/shared";
import type {
  LlmSection,
  ProviderSections,
  SessionContext,
  TurnMetrics,
  TurnPhase,
} from "@di/shared";
import type { Turn } from "@di/shared/session";
import { ClientAgent } from "../agent/client-agent";
import type { AgentToolExecutors } from "../agent/client-agent";
import { synthesizeSpeech } from "../agent/tts";
import { resolveInstalledVoiceEngines } from "./engines";
import type { ResolvedVoiceEngines, SttEngine, TtsEngine } from "./engines";
import { WasmStt, WasmTts } from "./wasm-engines";
import { startCapture } from "./capture";
import type { MicCapture } from "./capture";
import { createVadGate } from "./vad";
import type { VadGate, VadGateOptions } from "./vad";
import { createPcmPlayer } from "./pcm-player";
import type { PcmPlayer } from "./pcm-player";
import type { SpeechDriver } from "./server-driver";
import { LLM_TURN_TIMEOUT_MS, TTS_SENTENCE_TIMEOUT_MS } from "../timeouts";

/**
 * Browser driver, multi-mode. Engine resolution (lib/voice/engines.ts) picks
 * per-side: stt = sherpa zipformer worker + silero vad (wasm) or Web Speech
 * SpeechRecognition (builtin); tts = KittenTTS worker (wasm), BYO endpoint,
 * or speechSynthesis (builtin). When engines are wasm and consent+download
 * are in place, no SpeechRecognition is created at all — the mic stream is
 * captured once via MicCaptureImpl, which also kills the mic-indicator strobe.
 * Barge-in: vad speech-start or interim results during agent playback abort
 * the LLM/TTS pipeline and stop audio (p0.8).
 */

export interface RecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  /** immediate teardown without waiting for pending finals; absent in tests */
  abort?(): void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string; confidence?: number };
  }>;
}
type RecognitionCtor = new () => RecognitionLike;

export interface BrowserDriverDeps {
  recognitionCtor?: RecognitionCtor;
  player?: PcmPlayer;
  tts?: typeof synthesizeSpeech;
  speechSynthesis?: SpeechSynthesis | null;
  onMetrics?: (metrics: TurnMetrics) => void;
  /** mic acquisition for the anchor stream; tests inject a stub */
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<unknown>;
  /** test seam: replace the worker-backed wasm tts engine */
  wasmTtsEngine?: TtsEngine;
  /** test seam: replace the worker-backed wasm stt engine */
  wasmSttEngine?: SttEngine;
  /** test seam: mic capture factory for the wasm stt path */
  capture?: () => Promise<MicCapture>;
  /** test seam: vad factory for the wasm stt path */
  vad?: (opts: VadGateOptions) => Promise<VadGate>;
}

export class BrowserVoiceDriver implements SpeechDriver {
  status: SpeechDriver["status"] = "idle";
  agentSpeaking = false;
  onError: (message: string) => void = () => undefined;
  onReconnecting: (attempt: number) => void = () => undefined;
  events: SpeechDriver["events"] = {};

  private recognition: RecognitionLike | null = null;
  private muted = false;
  private restarting = false;
  private player: PcmPlayer;
  private agent: ClientAgent | null = null;
  private profile: ProviderSections | null = null;
  private engines: ResolvedVoiceEngines = { stt: "builtin", tts: "builtin" };
  private wasmTts: TtsEngine | null = null;
  private stt: SttEngine | null = null;
  private capture: MicCapture | null = null;
  private vad: VadGate | null = null;
  private pending = "";
  private abort: AbortController | null = null;
  private kickoffTimer: ReturnType<typeof setTimeout> | null = null;
  /** interim-result debounce during agent playback; fires interrupt() (p0.8) */
  private bargeInTimer: ReturnType<typeof setTimeout> | null = null;
  /** pending SpeechRecognition restart after onend; tracked so stop() cancels it */
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Anchor stream held for the driver's lifetime: SpeechRecognition spawns
   * and destroys its own OS capture session on every onend→start() cycle,
   * which strobes the OS mic indicator. A held getUserMedia track keeps the
   * indicator (and hardware lock) stable across those internal restarts.
   */
  private anchorStream: { getTracks(): { stop(): void }[] } | null = null;
  /** set when interim results arrive during the current utterance */
  private speechSeen = false;
  /** id of the user turn that already consumed the one retry (p0.4 guard) */
  private retriedTurnId: string | null = null;

  /** continuation grace before interim speech cuts the agent off (p0.8) */
  private static readonly BARGE_IN_GRACE_MS = 300;
  /** confidence at which an unconfirmed final is trusted without interim evidence */
  private static readonly MIN_CONFIDENCE = 0.6;
  /** recognition errors that must never trigger an onend restart loop */
  private static readonly FATAL_ERRORS = new Set(["not-allowed", "audio-capture"]);

  constructor(
    private readonly sessionId: string,
    private readonly deps: BrowserDriverDeps = {},
  ) {
    this.player = deps.player ?? createPcmPlayer();
  }

  /** Wire the client-only agent. Called by createDriver when an llm endpoint exists. */
  async useClientAgent(
    profile: ProviderSections & { llm: LlmSection },
    tools: AgentToolExecutors,
    toolset: Record<string, string>,
    getContext: () => SessionContext,
    fetchImpl?: typeof fetch,
  ): Promise<void> {
    this.profile = profile;
    this.engines = await resolveInstalledVoiceEngines();
    this.agent = await ClientAgent.create(profile.llm, tools, getContext, fetchImpl, toolset);
  }

  /**
   * Which tts path speak() takes this turn. "wasm" is the resolved pick —
   * getTtsEngine() lazy-creates the worker on first use; readiness was
   * checked during engine resolution.
   */
  private get ttsMode(): "wasm" | "endpoint" | "builtin" {
    if (this.engines.tts === "wasm") return "wasm";
    return this.profile?.tts !== undefined ? "endpoint" : "builtin";
  }

  private getTtsEngine(): TtsEngine | null {
    if (this.engines.tts !== "wasm") return null;
    this.wasmTts ??= this.deps.wasmTtsEngine ?? new WasmTts();
    return this.wasmTts;
  }

  async start(): Promise<void> {
    if (this.engines.stt === "wasm" && (await this.tryWasmStt())) return;
    const w = globalThis as unknown as {
      SpeechRecognition?: RecognitionCtor;
      webkitSpeechRecognition?: RecognitionCtor;
    };
    const Ctor = this.deps.recognitionCtor ?? w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor || (!("speechSynthesis" in globalThis) && !this.agent)) {
      this.status = "error";
      this.onError("speech recognition not supported in this browser");
      return;
    }
    const rec = new Ctor();
    this.recognition = rec;
    this.speechSeen = false;
    // mic errors surface through rec.onerror; a failed anchor is not fatal
    const gum =
      this.deps.getUserMedia ?? navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    this.anchorStream = gum
      ? ((await gum({ audio: true }).catch(() => null)) as {
          getTracks(): { stop(): void }[];
        } | null)
      : null;
    // stop() may have run while the mic request was pending: release the
    // just-acquired stream and bail instead of wiring a dead recognizer
    if (this.recognition !== rec) {
      this.releaseAnchor();
      return;
    }
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language ?? "en-US";
    rec.onresult = (ev) => this.handleResult(ev);
    rec.onerror = (ev) => {
      const kind = ev.error ?? "";
      // not-allowed/audio-capture are unrecoverable (permission/mic gone):
      // stop cleanly and report once. Setting status away from "connected"
      // also keeps the onend handler from restarting recognition in a loop.
      if (BrowserVoiceDriver.FATAL_ERRORS.has(kind)) {
        this.status = "error";
        // mic is gone: holding the anchor would keep the OS indicator lit
        // through the text-first fallback even though capture is dead
        this.releaseAnchor();
        // no mic is not the end of the interview: the kickoff stays armed so
        // the agent still opens; the composer keeps the session text-first.
        this.onError(
          kind === "not-allowed" ? "microphone permission denied" : "microphone unavailable",
        );
      }
    };
    // continuous mode ends on silence in some builds; restart while active.
    // the timer is tracked (restartTimer) and re-gated on identity so a
    // stop() inside the window never restarts an orphaned recognizer.
    rec.onend = () => {
      if (this.status === "connected" && !this.restarting && this.recognition === rec) {
        this.restarting = true;
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null;
          this.restarting = false;
          if (this.status !== "connected" || this.recognition !== rec) return;
          try {
            rec.start();
          } catch {
            // already started
          }
        }, 200);
      }
    };
    this.recognition = rec;
    this.status = "connected";
    rec.start();
    this.armKickoff();
  }

  /**
   * Wasm stt path: sherpa worker + own mic capture + silero vad. Returns
   * false when the engine cannot boot so start() falls back to builtin
   * SpeechRecognition. Mic/vad failures mirror the builtin fatal-error
   * path: status "error", kickoff still fires (text-first interview).
   */
  private async tryWasmStt(): Promise<boolean> {
    const stt = this.deps.wasmSttEngine ?? new WasmStt();
    try {
      await stt.start({
        onInterim: () => this.noteSpeech(),
        onFinal: (text) => this.noteFinal(text),
        onSpeechStart: () => this.noteSpeech(),
      });
    } catch (err) {
      this.onError(`[stt] ${String(err instanceof Error ? err.message : err)}`);
      return false;
    }
    this.stt = stt;
    this.status = "connected";
    try {
      const capture = await (this.deps.capture ?? (() => startCapture()))();
      this.capture = capture;
      const vadFactory = this.deps.vad ?? ((opts) => createVadGate(opts));
      this.vad = await vadFactory({
        onSpeechStart: () => this.noteSpeech(),
        onSpeechEnd: () => void stt.flush().catch(() => undefined),
      });
      capture.onFrame((pcm16) => this.vad?.processFrame(pcm16));
      capture.onFloat32Frame?.((samples) => stt.feed(samples));
    } catch (err) {
      this.status = "error";
      this.onError(
        `[mic] ${String(err instanceof Error ? err.message : err) || "microphone unavailable"}`,
      );
    }
    this.armKickoff();
    return true;
  }

  /** interim speech evidence: marks the utterance and arms barge-in. */
  private noteSpeech(): void {
    this.speechSeen = true;
    if (this.agentSpeaking && this.bargeInTimer === null) {
      this.bargeInTimer = setTimeout(() => {
        this.bargeInTimer = null;
        if (this.agentSpeaking) this.interrupt();
      }, BrowserVoiceDriver.BARGE_IN_GRACE_MS);
    }
  }

  /**
   * Utterance end with a transcript — vad-verified speech, so the
   * phantom-final gate the builtin path needs does not apply.
   */
  private noteFinal(text: string): void {
    const trimmed = text.trim();
    this.speechSeen = false;
    if (!trimmed || this.muted) return;
    this.cancelKickoff();
    this.events.onSpeechStart?.();
    this.events.onSpeechEnd?.(trimmed);
    if (this.agent) {
      void this.runAgentTurn(trimmed, "voice");
    }
  }

  /** rebuild recognition/agent transport after an error; model handles stay cached. */
  async restart(): Promise<void> {
    if (this.restarting) return;
    this.restarting = true;
    try {
      await this.stop();
      await this.start();
    } finally {
      this.restarting = false;
    }
  }

  /**
   * Cold-start dead-end guard: if the candidate never speaks after connect,
   * auto-fire the first agent turn after a short grace window so the
   * interview opens instead of sitting silent. Any real user input (speech
   * or typed turn) cancels it; it can only fire once.
   */
  private armKickoff(): void {
    if (!this.agent || this.kickoffTimer) return;
    this.kickoffTimer = setTimeout(() => {
      this.kickoffTimer = null;
      // "error" included: mic denial still fires the opening turn so the
      // user lands in a text-first interview instead of a dead page.
      if (this.status === "idle" || this.status === "connecting" || this.abort) return;
      void this.runAgentTurn(KICKOFF_UTTERANCE, "text");
    }, KICKOFF_DELAY_MS);
  }

  private cancelKickoff(): void {
    if (this.kickoffTimer) {
      clearTimeout(this.kickoffTimer);
      this.kickoffTimer = null;
    }
  }

  private handleResult(ev: SpeechRecognitionEventLike) {
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const result = ev.results[i];
      if (!result) continue;
      if (!result.isFinal) {
        // interim results only appear when the recognizer actually heard
        // audio: record it as speech evidence for the next final
        this.noteSpeech();
        continue;
      }
      const alt = result[0];
      const text = alt.transcript.trim();
      const confident = (alt.confidence ?? 0) >= BrowserVoiceDriver.MIN_CONFIDENCE;
      const hadSpeech = this.speechSeen;
      this.speechSeen = false;
      // phantom final: transcript with no observed speech (noise/hallucination)
      if (!hadSpeech && !confident) continue;
      if (!text || this.muted) continue;
      this.cancelKickoff();
      this.events.onSpeechStart?.();
      this.events.onSpeechEnd?.(text);
      if (this.agent) {
        void this.runAgentTurn(text, "voice");
      }
    }
  }

  /** Typed-input counterpart to speech recognition results (same agent turn path). */
  sendText(text: string): void {
    if (!text.trim() || !this.agent) return;
    this.cancelKickoff();
    void this.runAgentTurn(text.trim(), "text");
  }

  /** Stream the agent reply through sentence cutting into pipelined TTS. */
  private async runAgentTurn(text: string, source: Turn["source"]): Promise<void> {
    const agent = this.agent;
    const tts = this.deps.tts ?? synthesizeSpeech;
    if (!agent) return;
    const reportError = (error: unknown, phase: TurnPhase) =>
      this.onError(`[${phase}] ${String(error)}`);
    // barge-in from a previous turn: drop it
    this.abort?.abort();
    const ctrl = new AbortController();
    this.abort = ctrl;
    const userTurn: Turn = {
      id: crypto.randomUUID(),
      session_id: this.sessionId,
      seq: Date.now(),
      speaker: "user",
      text,
      created_at: new Date().toISOString(),
      source,
    };
    this.events.onUserTurn?.(userTurn);

    this.pending = "";
    let spoke = false;
    const speak = async (sentence: string) => {
      if (ctrl.signal.aborted || !sentence.trim()) return;
      if (!spoke) {
        spoke = true;
        this.agentSpeaking = true;
        this.events.onAgentStart?.();
      }
      try {
        const mode = this.ttsMode;
        if (mode === "builtin") {
          // final text is spoken by the speechSynthesis fallback in
          // speakAgentTurn instead
          return;
        }
        if (mode === "wasm") {
          const engine = this.getTtsEngine();
          if (!engine) return;
          const pcm = await engine.speak(sentence);
          if (ctrl.signal.aborted) return;
          this.player.writeFloat32(pcm);
          return;
        }
        const pcm = await tts(
          this.profile!.tts!,
          sentence,
          AbortSignal.any([
            ctrl.signal,
            // per-sentence budget: a stalled tts must skip the sentence, not
            // stall the speak queue (p0.3)
            AbortSignal.timeout(TTS_SENTENCE_TIMEOUT_MS),
          ]),
        );
        if (ctrl.signal.aborted) return;
        this.player.write(pcm);
      } catch (err) {
        if (!ctrl.signal.aborted) reportError(err, "tts");
      }
    };

    const first = await this.attemptAgentTurn(text, source, ctrl, speak, reportError);
    if (first !== "failed") return;
    // retry-once (p0.4/p1.3b2): a failed turn must not leave the user turn
    // dangling with no agent response. retry once, guarded by the turn id so
    // the failure surfaces at most once per user turn.
    if (this.retriedTurnId !== userTurn.id) {
      this.retriedTurnId = userTurn.id;
      this.pending = "";
      const retry = await this.attemptAgentTurn(text, source, ctrl, speak, reportError);
      if (retry !== "failed") return;
    }
    this.onError(`[${"llm" as TurnPhase}] no agent response for turn; retry also failed`);
    this.finishSpeaking();
  }

  private async attemptAgentTurn(
    text: string,
    source: Turn["source"],
    ctrl: AbortController,
    speak: (sentence: string) => Promise<void>,
    reportError: (error: unknown, phase: TurnPhase) => void,
  ): Promise<"ok" | "aborted" | "failed"> {
    const agent = this.agent;
    if (!agent) return "aborted";
    try {
      const full = await agent.respond(text, {
        signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(LLM_TURN_TIMEOUT_MS)]),
        onText: (delta) => {
          if (ctrl.signal.aborted) return;
          this.pending += delta;
          const { sentences, rest } = cutSentences(this.pending);
          this.pending = rest;
          for (const s of sentences) void speak(s);
        },
        // respond() resolves (rather than rejecting) when the LLM call
        // fails, so aborts from barge-in surface here instead of the catch
        // below; drop them so expected interrupts never read as errors.
        onError: (error, phase) => {
          if (!ctrl.signal.aborted) reportError(error, phase);
        },
        onMetrics: (metrics) => this.deps.onMetrics?.(metrics),
      });
      if (ctrl.signal.aborted) return "aborted";
      // flush the sentence remainder
      if (this.pending.trim()) {
        const rest = this.pending;
        this.pending = "";
        await speak(rest);
      }
      // empty response means the LLM call failed; treat as failed so the
      // retry-once path can fire instead of dangling the user turn.
      if (!full.trim()) return "failed";
      const agentTurn: Turn = {
        id: crypto.randomUUID(),
        session_id: this.sessionId,
        seq: Date.now() + 1,
        speaker: "agent",
        text: full,
        created_at: new Date().toISOString(),
        source,
      };
      this.events.onAgentTurn?.(agentTurn);
      // speechSynthesis fallback when neither wasm tts nor an endpoint runs
      if (this.ttsMode === "builtin") this.speakAgentTurn(full);
      this.finishSpeaking();
      return "ok";
    } catch (err) {
      if (ctrl.signal.aborted) return "aborted";
      reportError(err, "llm");
      return "failed";
    }
  }

  private finishSpeaking() {
    if (this.agentSpeaking) {
      this.agentSpeaking = false;
      this.events.onAgentDone?.();
    }
  }

  /** speechSynthesis fallback (no TTS endpoint): speak final text. */
  speakAgentTurn(text: string) {
    const synth = this.deps.speechSynthesis ?? globalThis.speechSynthesis ?? null;
    if (this.muted || !synth) return;
    const utter = new SpeechSynthesisUtterance(text);
    utter.onend = () => this.finishSpeaking();
    this.agentSpeaking = true;
    this.events.onAgentStart?.();
    synth.speak(utter);
  }

  /**
   * Barge-in: called from the route's VAD path when the user starts speaking
   * during agent playback. Same semantics as the server interrupt.
   */
  interrupt(): void {
    this.player.stop();
    this.abort?.abort();
    this.abort = null;
    if (this.ttsMode === "builtin") globalThis.speechSynthesis?.cancel();
    this.finishSpeaking();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.capture?.setMuted(muted);
    if (muted) {
      this.interrupt();
    }
  }

  private releaseAnchor(): void {
    this.anchorStream?.getTracks().forEach((t) => t.stop());
    this.anchorStream = null;
  }

  async stop(): Promise<void> {
    this.cancelKickoff();
    if (this.bargeInTimer !== null) {
      clearTimeout(this.bargeInTimer);
      this.bargeInTimer = null;
    }
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.restarting = false;
    // idle before teardown so a queued onend cannot schedule a restart
    this.status = "idle";
    const rec = this.recognition;
    this.recognition = null;
    try {
      if (rec?.abort) rec.abort();
      else rec?.stop();
    } catch {
      // teardown must not throw
    }
    this.interrupt();
    this.releaseAnchor();
    this.wasmTts?.dispose();
    this.wasmTts = null;
    void this.stt?.stop();
    this.stt = null;
    void this.capture?.stop();
    this.capture = null;
    void this.vad?.destroy();
    this.vad = null;
    this.agentSpeaking = false;
  }
}
