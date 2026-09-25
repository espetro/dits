import { assign, setup } from "xstate";

export type VoiceEvent =
  | { type: "CONNECT" }
  | { type: "CONNECTED" }
  | { type: "CONNECT_FAILED" }
  | { type: "SPEECH_START" }
  | { type: "SPEECH_END"; text: string }
  | { type: "TRANSCRIPT"; text: string }
  | { type: "AGENT_START" }
  | { type: "AGENT_DONE" }
  | { type: "INTERRUPT" }
  | { type: "RECONNECTING"; attempt: number }
  | { type: "ERROR"; message: string }
  | { type: "RETRY" }
  | { type: "RESET" };

export interface VoiceContext {
  error: string | null;
  lastUserText: string | null;
}

/**
 * Turn FSM for the voice loop. States: idle | connecting | listening |
 * user_speaking | thinking | agent_speaking | interrupted | reconnecting |
 * error. Mute is
 * orthogonal state (kept in $muted), not a machine state. Barge-in:
 * SPEECH_START while agent_speaking moves to interrupted; the driver stops
 * playback, the pipeline re-enters thinking.
 */
export const voiceMachine = setup({
  types: {
    context: {} as VoiceContext,
    events: {} as VoiceEvent,
  },
  actions: {
    setConnectError: assign(() => ({ error: "connect failed" })),
    setError: assign(({ event }) => ({
      error: event.type === "ERROR" ? event.message : null,
    })),
    saveUserText: assign(({ event }) => ({
      lastUserText: event.type === "SPEECH_END" || event.type === "TRANSCRIPT" ? event.text : null,
    })),
    clear: assign(() => ({ error: null, lastUserText: null })),
  },
}).createMachine({
  id: "voice",
  context: { error: null, lastUserText: null },
  initial: "idle",
  states: {
    idle: {
      on: { CONNECT: "connecting" },
    },
    connecting: {
      on: {
        CONNECTED: "listening",
        CONNECT_FAILED: { target: "error", actions: "setConnectError" },
      },
    },
    reconnecting: {
      on: {
        // resume protocol is a p1 follow-up: a fresh socket just continues
        CONNECTED: "listening",
      },
    },
    listening: {
      on: { SPEECH_START: "user_speaking" },
    },
    user_speaking: {
      on: {
        // empty transcript means the VAD fired on noise; back to listening
        SPEECH_END: [
          {
            target: "listening",
            guard: ({ event }) => event.text.trim() === "",
          },
          { target: "thinking", actions: "saveUserText" },
        ],
      },
    },
    thinking: {
      on: {
        AGENT_START: "agent_speaking",
        // server had nothing to say: back to listening
        ERROR: { target: "listening" },
      },
    },
    agent_speaking: {
      on: {
        AGENT_DONE: "listening",
        // barge-in: stop playback, let the pipeline continue
        SPEECH_START: "interrupted",
      },
    },
    interrupted: {
      on: {
        AGENT_DONE: "thinking",
        // pipeline already gave up on the interrupted utterance
        ERROR: "thinking",
      },
    },
    error: {
      on: {
        RESET: { target: "idle", actions: "clear" },
        // retry: driver restart rebuilds the socket/recognizer and reconnects
        RETRY: { target: "idle", actions: "clear" },
      },
    },
  },
  on: {
    ERROR: { target: ".error", actions: "setError" },
    // unexpected ws close from any active state kicks off the reconnect loop
    RECONNECTING: ".reconnecting",
  },
});
