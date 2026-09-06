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

interface RecognitionLike {
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
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
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
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language ?? "en-US";
    rec.onresult = (ev) => this.handleResult(ev);
    rec.onerror = (ev) => {
      if (ev.error === "not-allowed") {
        this.status = "error";
        this.onError("microphone permission denied");
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
  }

  private handleResult(ev: SpeechRecognitionEventLike) {
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const result = ev.results[i];
      if (!result || !result.isFinal) continue;
      const text = result[0].transcript.trim();
      if (!text || this.muted) continue;
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
    this.recognition?.stop();
    this.recognition = null;
    this.interrupt();
    this.status = "idle";
    this.agentSpeaking = false;
  }
}
