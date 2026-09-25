import * as React from "react";
import { createActor } from "xstate";
import type { Turn } from "@di/shared/session";
import { appendTurn } from "../agent/session-store";
import { appendClientTurn } from "../opfs-store";
import { $question } from "../../stores/session";
import { BrowserVoiceDriver } from "./browser-driver";
import { createDriver } from "./index";
import { voiceMachine } from "./machine";
import { MODEL_LOAD_TIMEOUT_MS } from "../timeouts";
import type { SpeechDriver } from "./server-driver";

/** Shape-compatible with the old VoiceRoom hook so the header UI keeps working. */
export interface VoiceState {
  status: "idle" | "connecting" | "connected" | "reconnecting" | "error";
  agentSpeaking: boolean;
  error: string | null;
  phase: string;
  muted: boolean;
  /** run a typed turn through the agent (WS message in server mode) */
  sendText(text: string): void;
  /** rebuild the driver after a voice error; success returns to connected */
  restart(): Promise<void>;
}

interface VoiceCoreState {
  status: VoiceState["status"];
  agentSpeaking: boolean;
  error: string | null;
  phase: string;
  muted: boolean;
}

/**
 * Voice loop hook: driver (server WS or browser Web Speech) + xstate turn
 * machine. Mute is applied via driver.setMuted and $muted stays the source
 * of truth in the route. StrictMode-safe via the cancelled flag.
 */
export function useVoice(sessionId: string, muted: boolean): VoiceState {
  const [state, setState] = React.useState<VoiceCoreState>({
    status: "idle",
    agentSpeaking: false,
    error: null,
    phase: "idle",
    muted,
  });
  const driverRef = React.useRef<SpeechDriver | null>(null);
  const actorRef = React.useRef<ReturnType<typeof createActor<typeof voiceMachine>> | null>(null);
  const sendText = React.useCallback((text: string) => {
    driverRef.current?.sendText(text);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    setState({
      status: "connecting",
      agentSpeaking: false,
      error: null,
      phase: "connecting",
      muted: false,
    });

    const actor = createActor(voiceMachine);
    actorRef.current = actor;

    async function boot() {
      let driver: SpeechDriver;
      try {
        driver = await createDriver(sessionId, AbortSignal.timeout(MODEL_LOAD_TIMEOUT_MS));
      } catch (err) {
        if (!cancelled) {
          setState((s) => ({ ...s, status: "error", error: String(err) }));
        }
        return;
      }
      if (cancelled) return void driver.stop();
      driverRef.current = driver;

      driver.onError = (message: string) => {
        actor.send({ type: "ERROR", message });
        if (!cancelled) setState((s) => ({ ...s, status: "error", error: message }));
      };
      driver.onReconnecting = (attempt: number) => {
        actor.send({ type: "RECONNECTING", attempt });
        if (!cancelled) setState((s) => ({ ...s, status: "reconnecting", phase: "reconnecting" }));
      };
      driver.events.onSpeechStart = () => actor.send({ type: "SPEECH_START" });
      driver.events.onSpeechEnd = (text) => actor.send({ type: "SPEECH_END", text });
      // server driver: transcript display via turns polling instead (di
      // already persisted the turn server-side when it emitted this event).
      // browser driver: nothing else persists this turn, so do it here.
      // Real seqs come from the store (last seq + 1), not from the driver's
      // ad-hoc ids, so OPFS rows match what the server would have written.
      const onClientTurn = (turn: Turn) => {
        const stored = appendTurn(sessionId, turn.speaker, turn.text, turn.source);
        void appendClientTurn(sessionId, stored);
      };
      driver.events.onUserTurn = (turn: Turn) => {
        if (driver instanceof BrowserVoiceDriver) onClientTurn(turn);
      };
      driver.events.onAgentTurn = (turn: Turn) => {
        if (driver instanceof BrowserVoiceDriver) onClientTurn(turn);
      };
      // server driver: question.updated tool calls arrive as ws messages
      driver.events.onQuestion = (q) => $question.set({ text: q.text, hints: q.hints });
      driver.events.onAgentStart = () => actor.send({ type: "AGENT_START" });
      driver.events.onAgentDone = () => actor.send({ type: "AGENT_DONE" });

      actor.subscribe((snap) => {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          phase: String(snap.value),
          agentSpeaking:
            snap.value === "agent_speaking"
              ? true
              : snap.value === "listening"
                ? false
                : s.agentSpeaking,
        }));
      });
      actor.start();

      try {
        actor.send({ type: "CONNECT" });
        await driver.start();
        if (cancelled) return void driver.stop();
        actor.send({ type: "CONNECTED" });
        if (!cancelled) setState((s) => ({ ...s, status: "connected" }));
      } catch (err) {
        actor.send({ type: "CONNECT_FAILED" });
        if (!cancelled) {
          setState((s) => ({
            ...s,
            status: "error",
            error: err instanceof Error ? err.message : "voice start failed",
          }));
        }
      }
    }
    void boot();

    return () => {
      cancelled = true;
      actor.stop();
      actorRef.current = null;
      void driverRef.current?.stop();
      driverRef.current = null;
    };
    // sessionId fixed per mount; muted handled by the follow-up effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  React.useEffect(() => {
    driverRef.current?.setMuted(muted);
    setState((s) => ({ ...s, muted }));
  }, [muted]);

  const restart = React.useCallback(async () => {
    const driver = driverRef.current;
    if (!driver) return;
    setState((s) => ({ ...s, status: "connecting", phase: "connecting" }));
    actorRef.current?.send({ type: "RETRY" });
    try {
      await driver.restart();
      actorRef.current?.send({ type: "CONNECTED" });
      setState((s) => ({ ...s, status: "connected", error: null }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "voice restart failed";
      actorRef.current?.send({ type: "CONNECT_FAILED" });
      setState((s) => ({ ...s, status: "error", error: message }));
    }
  }, []);

  return { ...state, sendText, restart };
}
