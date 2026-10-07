import * as React from "react";
import { createActor } from "xstate";
import type { Turn } from "@di/shared/session";
import { appendTurn } from "../agent/session-store";
import { appendClientTurn } from "../opfs-store";
import { $providerProfile } from "../runtime";
import {
  $voiceDownload,
  $voiceModelsConsent,
  $voiceSttEngine,
  $voiceTtsEngine,
} from "../../stores/voice";
import { setQuestion } from "../../stores/session";
import { BrowserVoiceDriver } from "./browser-driver";
import { errorCode } from "../errors";
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

/** turn-pipeline codes a successful reply unlatches; hardware/boot errors
 * persist until the retry path rebuilds the driver */
const RECOVERABLE_VOICE_ERRORS = new Set([
  "voice.llm",
  "voice.tts",
  "voice.stt",
  "voice.noResponse",
]);

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
  // bootNonce bumps force a full driver teardown + rebuild (profile change).
  const [bootNonce, setBootNonce] = React.useState(0);
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
          setState((s) => ({ ...s, status: "error", error: errorCode(err) ?? "voice.boot" }));
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
        // a landed reply proves the pipeline recovered: unlatch turn errors
        // (llm/tts/stt/noResponse). mic/boot/connect failures stay latched —
        // a reply can't resurrect dead capture or a missing driver.
        actor.send({ type: "RECOVERED" });
        setState((s) =>
          s.error && RECOVERABLE_VOICE_ERRORS.has(s.error)
            ? { ...s, status: "connected", error: null }
            : s,
        );
      };
      // server driver: question.updated tool calls arrive as ws messages
      driver.events.onQuestion = (q) => setQuestion({ text: q.text, hints: q.hints });
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
            error: errorCode(err) ?? "voice.start",
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
  }, [sessionId, bootNonce]);

  // p1: a saved provider profile rebuilds the client-side agent — the driver
  // must re-init, not keep the stale llm/stt/tts it was constructed with.
  // Only the browser driver consumes the profile; the server driver reads
  // server-side config, so a profile edit is a no-op there.
  React.useEffect(() => {
    let prev = JSON.stringify($providerProfile.get());
    return $providerProfile.listen((profile) => {
      const next = JSON.stringify(profile);
      if (next === prev) return;
      prev = next;
      if (driverRef.current instanceof BrowserVoiceDriver) setBootNonce((n) => n + 1);
    });
  }, []);

  // wasm voice engines: a pick/consent change or a finished model download
  // flips the engine resolution, so the driver must re-init. Download
  // progress ticks only rebuild on the idle->ready/error edge.
  React.useEffect(() => {
    const rebuild = () => {
      if (driverRef.current instanceof BrowserVoiceDriver) setBootNonce((n) => n + 1);
    };
    const unsubs = [$voiceSttEngine, $voiceTtsEngine, $voiceModelsConsent].map((s) =>
      s.listen(rebuild),
    );
    let prevStatus = $voiceDownload.get().status;
    unsubs.push(
      $voiceDownload.listen((d) => {
        const prev = prevStatus;
        prevStatus = d.status;
        if (prev === "downloading" && d.status === "ready") rebuild();
      }),
    );
    return () => unsubs.forEach((unsub) => unsub());
  }, []);

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
      actorRef.current?.send({ type: "CONNECT_FAILED" });
      setState((s) => ({
        ...s,
        status: "error",
        error: errorCode(err) ?? "voice.restart",
      }));
    }
  }, []);

  return { ...state, sendText, restart };
}
