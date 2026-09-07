import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { createSession } from "../../lib/api";
import { ServerVoiceDriver } from "../../lib/voice/server-driver";
import type { ServerDriverDeps, SpeechDriver } from "../../lib/voice/server-driver";
import { createPcmPlayer } from "../../lib/voice/pcm-player";
import type { PcmPlayer } from "../../lib/voice/pcm-player";
import { CAPTURE_SAMPLE_RATE, AUDIO_HEADER_BYTES } from "@di/shared/voice";
import type { Turn, TurnMetrics } from "@di/shared";
import type { MicCapture } from "../../lib/voice/capture";
import type { VadGate } from "../../lib/voice/vad";

export const Route = createFileRoute("/{-$locale}/dev/voice-harness")({
  head: () => ({ meta: [{ title: "voice harness — di" }] }),
  component: VoiceHarness,
});

const UTTERANCE_MS = 1_500;
const FRAME_MS = 100;
const TURN_TIMEOUT_MS = 20_000;
const SCENARIO_FREQS = [220, 330];

/**
 * Dev-only functional harness (p3.1): drives the ServerVoiceDriver WS loop
 * with synthetic PCM16 sine/harmonic utterances. No mic, no AudioContext, no
 * VAD model: the mock provider (server config) makes the full turn loop
 * deterministic for screen recordings and the playwright smoke spec.
 */

/** Emits paced synthetic frames through the driver's normal capture path. */
class SyntheticCapture implements MicCapture {
  private cb: ((pcm16: Uint8Array) => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  onFrame(cb: (pcm16: Uint8Array) => void): void {
    this.cb = cb;
  }
  onLevel(): void {}
  setMuted(): void {}
  async stop(): Promise<void> {
    this.clear();
    this.cb = null;
  }

  playUtterance(freqHz: number, durationMs: number): Promise<void> {
    this.clear();
    const samples = Math.floor((CAPTURE_SAMPLE_RATE * FRAME_MS) / 1000);
    const total = Math.ceil(durationMs / FRAME_MS);
    let emitted = 0;
    return new Promise((resolve) => {
      this.timer = setInterval(() => {
        emitted += 1;
        if (emitted > total || !this.cb) {
          this.clear();
          resolve();
          return;
        }
        this.cb(synthFrame(freqHz, samples, (emitted - 1) * samples));
      }, FRAME_MS);
    });
  }

  private clear(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

/** Sine + 2nd/3rd harmonics, PCM16LE mono 16k, so the STT sees real audio. */
function synthFrame(freqHz: number, samples: number, startSample: number): Uint8Array {
  const out = new Uint8Array(samples * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples; i++) {
    const t = (startSample + i) / CAPTURE_SAMPLE_RATE;
    const s =
      0.6 * Math.sin(2 * Math.PI * freqHz * t) +
      0.25 * Math.sin(2 * Math.PI * freqHz * 2 * t) +
      0.1 * Math.sin(2 * Math.PI * freqHz * 3 * t);
    view.setInt16(i * 2, Math.round(Math.max(-1, Math.min(1, s)) * 32_000), true);
  }
  return out;
}

/** Scripted stand-in for the silero VAD: the harness begins/ends utterances. */
class ScriptedVad implements VadGate {
  constructor(
    private readonly opts: {
      onSpeechStart: () => void;
      onSpeechEnd: (audio: Float32Array) => void;
    },
  ) {}
  processFrame(): void {}
  async destroy(): Promise<void> {}
  begin(): void {
    this.opts.onSpeechStart();
  }
  end(): void {
    this.opts.onSpeechEnd(new Float32Array(0));
  }
}

interface HarnessHandles {
  capture: SyntheticCapture;
  vad: ScriptedVad | null;
}

/** WS tap so the harness can read `metrics` messages the driver ignores. */
interface TappedWebSocketCtor {
  new (url: string): WebSocket;
}

class TappedWebSocket extends WebSocket {
  constructor(url: string, tap: (ev: MessageEvent) => void) {
    super(url);
    this.addEventListener("message", tap);
  }
}

const tappedWebSocketCtor = (tap: (ev: MessageEvent) => void): TappedWebSocketCtor =>
  class extends TappedWebSocket {
    constructor(url: string) {
      super(url, tap);
    }
  };

interface HarnessState {
  sessionId: string | null;
  conn: SpeechDriver["status"] | "ready";
  userText: string;
  agentText: string;
  agentSpeaking: boolean;
  metrics: TurnMetrics | null;
  error: string | null;
  running: boolean;
}

function makeDeps(handles: HarnessHandles, onMetrics: (m: TurnMetrics) => void): ServerDriverDeps {
  const tap = (ev: MessageEvent) => {
    if (typeof ev.data !== "string") return;
    try {
      const msg = JSON.parse(ev.data) as { t?: string; metrics?: TurnMetrics };
      if (msg.t === "metrics" && msg.metrics) onMetrics(msg.metrics);
    } catch {
      // non-json control traffic; ignore
    }
  };
  return {
    capture: async () => handles.capture,
    vad: async (opts) => {
      const vad = new ScriptedVad(opts);
      handles.vad = vad;
      return vad;
    },
    player: createSilentPlayer(),
    WebSocketCtor: tappedWebSocketCtor(tap),
  };
}

/** TTS frames are counted, not played: the harness needs no audio out. */
function createSilentPlayer(): PcmPlayer {
  let bytes = 0;
  return {
    write(pcm) {
      bytes += Math.max(0, pcm.byteLength - AUDIO_HEADER_BYTES);
    },
    stop() {},
    onDrained() {},
    get playing() {
      return bytes > 0;
    },
  };
}

function VoiceHarness() {
  const [state, setState] = useState<HarnessState>({
    sessionId: null,
    conn: "idle",
    userText: "",
    agentText: "",
    agentSpeaking: false,
    metrics: null,
    error: null,
    running: false,
  });
  const driverRef = useRef<ServerVoiceDriver | null>(null);
  const handlesRef = useRef<HarnessHandles | null>(null);
  const metricsCountRef = useRef(0);

  function patch(p: Partial<HarnessState>): void {
    setState((s) => ({ ...s, ...p }));
  }

  async function newSession(): Promise<void> {
    driverRef.current?.stop().catch(() => undefined);
    driverRef.current = null;
    handlesRef.current = null;
    metricsCountRef.current = 0;
    patch({
      sessionId: null,
      conn: "connecting",
      userText: "",
      agentText: "",
      agentSpeaking: false,
      metrics: null,
      error: null,
      running: false,
    });
    try {
      const session = await createSession({
        title: "voice harness",
        mode: "interview",
        duration_min: 15,
      });
      const handles: HarnessHandles = { capture: new SyntheticCapture(), vad: null };
      const driver = new ServerVoiceDriver(
        session.id,
        makeDeps(handles, (m) => {
          metricsCountRef.current += 1;
          patch({ metrics: m });
        }),
      );
      driver.onError = (message) => patch({ error: message, conn: "error" });
      driver.events.onSpeechStart = () => patch({ agentSpeaking: false });
      driver.events.onUserTurn = (turn: Turn) => patch({ userText: turn.text });
      driver.events.onAgentTurn = (turn: Turn) => patch({ agentText: turn.text });
      driver.events.onAgentStart = () => patch({ agentSpeaking: true });
      driver.events.onAgentDone = () => patch({ agentSpeaking: false });
      driverRef.current = driver;
      handlesRef.current = handles;
      patch({ sessionId: session.id });
      await driver.start();
      patch({ conn: driver.status === "connected" ? "ready" : driver.status });
    } catch (err) {
      patch({
        conn: "error",
        error: err instanceof Error ? err.message : "session start failed",
      });
    }
  }

  function waitForTurn(prevCount: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (metricsCountRef.current > prevCount) {
          clearInterval(iv);
          resolve();
        } else if (Date.now() - t0 > TURN_TIMEOUT_MS) {
          clearInterval(iv);
          reject(new Error("turn timed out waiting for metrics"));
        }
      }, 200);
    });
  }

  async function runScenario(): Promise<void> {
    const handles = handlesRef.current;
    if (!handles?.vad || state.running) return;
    patch({ running: true, error: null });
    try {
      for (const freq of SCENARIO_FREQS) {
        const prev = metricsCountRef.current;
        handles.vad.begin();
        await handles.capture.playUtterance(freq, UTTERANCE_MS);
        handles.vad.end();
        await waitForTurn(prev);
      }
    } catch (err) {
      patch({ error: err instanceof Error ? err.message : "scenario failed" });
    } finally {
      patch({ running: false });
    }
  }

  /** speak during agent tts: the driver converts it into an interrupt. */
  function bargeIn(): void {
    const vad = handlesRef.current?.vad;
    if (!vad) return;
    vad.begin();
    setTimeout(() => vad.end(), 300);
  }

  const busy = state.running || state.conn === "connecting";

  return (
    <div className="ambient grain min-h-[100dvh] bg-cream">
      <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-10 md:px-8">
        <h1 className="font-display text-xl font-semibold">voice functional harness</h1>
        <p className="mt-1 text-sm text-espresso-soft">
          deterministic voice loop against the mock provider: no mic, scripted utterances, canned
          replies.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <span
            data-testid="harness-status"
            className="rounded-full bg-white px-4 py-1.5 font-mono text-xs uppercase tracking-wide ring-1 ring-hairline"
          >
            {state.conn}
            {state.sessionId ? ` · ${state.sessionId.slice(0, 8)}` : ""}
          </span>
          <button
            data-testid="run-scenario"
            onClick={() => void runScenario()}
            disabled={busy || state.conn !== "ready"}
            className="rounded-full bg-espresso px-5 py-2 text-sm font-medium text-cream transition-all active:scale-[0.97] disabled:opacity-50"
          >
            run scenario
          </button>
          <button
            data-testid="barge-in"
            onClick={bargeIn}
            disabled={busy || !state.agentSpeaking}
            className="rounded-full bg-white px-5 py-2 text-sm font-medium text-espresso ring-1 ring-hairline transition-all active:scale-[0.97] disabled:opacity-50"
          >
            barge-in
          </button>
          <button
            data-testid="reset"
            onClick={() => void newSession()}
            disabled={state.conn === "connecting"}
            className="rounded-full bg-white px-5 py-2 text-sm font-medium text-espresso ring-1 ring-hairline transition-all active:scale-[0.97] disabled:opacity-50"
          >
            reset
          </button>
        </div>

        {!state.sessionId && (
          <button
            data-testid="connect"
            onClick={() => void newSession()}
            className="mt-6 rounded-full bg-persimmon px-6 py-3 text-sm font-semibold text-cream transition-all active:scale-[0.97]"
          >
            create session + connect
          </button>
        )}

        {state.error && (
          <p role="alert" data-testid="harness-error" className="mt-4 text-sm text-persimmon-deep">
            {state.error}
          </p>
        )}

        <section className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-card bg-paper p-4 ring-1 ring-hairline">
            <h2 className="text-[10px] uppercase tracking-[0.2em] text-espresso-soft">user</h2>
            <p data-testid="user-transcript" className="mt-2 min-h-12 text-sm">
              {state.userText || "—"}
            </p>
          </div>
          <div className="rounded-card bg-paper p-4 ring-1 ring-hairline">
            <h2 className="text-[10px] uppercase tracking-[0.2em] text-espresso-soft">agent</h2>
            <p data-testid="agent-transcript" className="mt-2 min-h-12 text-sm">
              {state.agentText || "—"}
            </p>
          </div>
        </section>

        <section className="mt-4 rounded-card bg-paper p-4 ring-1 ring-hairline">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3 font-mono text-sm">
            <span
              data-testid="tts-indicator"
              className={`rounded-full px-4 py-1.5 text-xs uppercase tracking-wide ${
                state.agentSpeaking ? "bg-persimmon text-cream" : "bg-white ring-1 ring-hairline"
              }`}
            >
              tts {state.agentSpeaking ? "playing" : "idle"}
            </span>
            <span data-testid="metric-llm">
              llm ttft:{" "}
              {state.metrics?.llm_ttft_ms != null ? `${state.metrics.llm_ttft_ms}ms` : "—"}
            </span>
            <span data-testid="metric-total">
              total: {state.metrics ? `${state.metrics.total_ms}ms` : "—"}
            </span>
            <span data-testid="metric-stt">
              stt: {state.metrics?.stt_ms != null ? `${state.metrics.stt_ms}ms` : "—"}
            </span>
          </div>
        </section>
      </main>
    </div>
  );
}
