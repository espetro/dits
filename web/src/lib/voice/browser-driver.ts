import { cutSentences } from "@di/shared";
import type {
  ProviderEndpoint,
  ProviderSections,
  SessionContext,
  TurnMetrics,
  TurnPhase,
} from "@di/shared";
import type { Turn } from "@di/shared/session";
import { ClientAgent } from "../agent/client-agent";
import type { AgentToolExecutors } from "../agent/client-agent";
import { synthesizeSpeech } from "../agent/tts";
import { createPcmPlayer } from "./pcm-player";
import type { PcmPlayer } from "./pcm-player";
import type { SpeechDriver } from "./server-driver";

/**
 * Browser driver, dual-mode:
 * - client-only runtime (provider profile configured): SpeechRecognition STT
 *   drives ClientAgent; streamed text is cut into sentences, each synthesized
 *   via the BYO TTS endpoint into PcmPlayer (24k PCM16). Barge-in (speech
 *   start during agent playback) aborts the LLM/TTS pipeline and stops audio.
 * - no TTS endpoint configured (ttsModel empty) or no SpeechRecognition:
 *   Web Speech API behavior: speechSynthesis speaks the final agent text.
 */

export interface RecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
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
}

export class BrowserVoiceDriver implements SpeechDriver {
  status: SpeechDriver["status"] = "idle";
  agentSpeaking = false;
  onError: (message: string) => void = () => undefined;
  events: SpeechDriver["events"] = {};

  private recognition: RecognitionLike | null = null;
  private muted = false;
  private restarting = false;
  private player: PcmPlayer;
  private agent: ClientAgent | null = null;
  private profile: ProviderSections | null = null;
  private pending = "";
  private abort: AbortController | null = null;
  private kickoffTimer: ReturnType<typeof setTimeout> | null = null;
  /** set when interim results arrive during the current utterance */
  private speechSeen = false;

  /**
   * Sent as a user turn when the candidate is silent after connect, so the
   * agent opens the interview instead of the page sitting idle. Phrased as a
   * direct instruction so the LLM asks a question rather than commenting on
   * the parenthetical.
   */
  private static readonly KICKOFF =
    "(candidate has joined — begin the interview now: greet them briefly and ask your first question)";
  private static readonly KICKOFF_MS = 5_000;
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
  useClientAgent(
    profile: ProviderSections & { llm: ProviderEndpoint },
    tools: AgentToolExecutors,
    getContext: () => SessionContext,
    fetchImpl?: typeof fetch,
  ): void {
    this.profile = profile;
    this.agent = new ClientAgent(profile.llm, tools, getContext, fetchImpl);
  }

  private get useTtsEndpoint(): boolean {
    return this.profile?.tts !== undefined;
  }

  async start(): Promise<void> {
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
    this.speechSeen = false;
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
        this.cancelKickoff();
        this.onError(
          kind === "not-allowed" ? "microphone permission denied" : "microphone unavailable",
        );
      }
    };
    // continuous mode ends on silence in some builds; restart while active
    rec.onend = () => {
      if (this.status === "connected" && !this.restarting) {
        this.restarting = true;
        setTimeout(() => {
          this.restarting = false;
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
   * Cold-start dead-end guard: if the candidate never speaks after connect,
   * auto-fire the first agent turn after a short grace window so the
   * interview opens instead of sitting silent. Any real user input (speech
   * or typed turn) cancels it; it can only fire once.
   */
  private armKickoff(): void {
    if (!this.agent || this.kickoffTimer) return;
    this.kickoffTimer = setTimeout(() => {
      this.kickoffTimer = null;
      if (this.status !== "connected" || this.abort) return;
      void this.runAgentTurn(BrowserVoiceDriver.KICKOFF, "text");
    }, BrowserVoiceDriver.KICKOFF_MS);
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
        this.speechSeen = true;
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
        const pcm = await tts(this.profile!.tts!, sentence, ctrl.signal);
        if (ctrl.signal.aborted) return;
        this.player.write(pcm);
      } catch (err) {
        if (!ctrl.signal.aborted) reportError(err, "tts");
      }
    };

    try {
      const full = await agent.respond(text, {
        signal: ctrl.signal,
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
      if (ctrl.signal.aborted) return;
      // flush the sentence remainder
      if (this.pending.trim()) {
        const rest = this.pending;
        this.pending = "";
        await speak(rest);
      }
      // full is empty when the LLM call failed: respond()'s onError sink
      // reports the failure but resolves rather than rejecting, so guard
      // here instead of persisting an empty agent turn.
      if (full.trim()) {
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
        // speechSynthesis fallback when no TTS endpoint is configured
        if (!this.useTtsEndpoint) this.speakAgentTurn(full);
      }
      this.finishSpeaking();
    } catch (err) {
      if (!ctrl.signal.aborted) {
        reportError(err, "llm");
        this.finishSpeaking();
      }
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
    if (!this.useTtsEndpoint) globalThis.speechSynthesis?.cancel();
    this.finishSpeaking();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) {
      this.interrupt();
    }
  }

  async stop(): Promise<void> {
    this.cancelKickoff();
    this.recognition?.stop();
    this.recognition = null;
    this.interrupt();
    this.status = "idle";
    this.agentSpeaking = false;
  }
}
