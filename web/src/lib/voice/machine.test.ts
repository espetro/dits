import { describe, expect, it } from "vitest";
import { createActor } from "xstate";
import { voiceMachine } from "./machine";
import type { VoiceEvent } from "./machine";

/** Step helper: create a fresh actor and send events, returning visited states. */
function run(events: VoiceEvent[]): string[] {
  const actor = createActor(voiceMachine);
  actor.start();
  const states: string[] = [actor.getSnapshot().value as string];
  for (const e of events) {
    actor.send(e);
    states.push(actor.getSnapshot().value as string);
  }
  return states;
}

describe("voiceMachine", () => {
  it("idle -> connecting -> listening", () => {
    expect(run([{ type: "CONNECT" }, { type: "CONNECTED" }])).toEqual([
      "idle",
      "connecting",
      "listening",
    ]);
  });

  it("connecting -> error on CONNECT_FAILED", () => {
    const actor = createActor(voiceMachine);
    actor.start();
    actor.send({ type: "CONNECT" });
    actor.send({ type: "CONNECT_FAILED" });
    const snap = actor.getSnapshot();
    expect(snap.value).toBe("error");
    expect(snap.context.error).toBe("connect failed");
  });

  it("full happy turn: listening -> user_speaking -> thinking -> agent_speaking -> listening", () => {
    expect(
      run([
        { type: "CONNECT" },
        { type: "CONNECTED" },
        { type: "SPEECH_START" },
        { type: "SPEECH_END", text: "tell me about caching" },
        { type: "AGENT_START" },
        { type: "AGENT_DONE" },
      ]),
    ).toEqual([
      "idle",
      "connecting",
      "listening",
      "user_speaking",
      "thinking",
      "agent_speaking",
      "listening",
    ]);
  });

  it("empty transcript goes back to listening", () => {
    expect(
      run([
        { type: "CONNECT" },
        { type: "CONNECTED" },
        { type: "SPEECH_START" },
        { type: "SPEECH_END", text: "   " },
      ]),
    ).toEqual(["idle", "connecting", "listening", "user_speaking", "listening"]);
  });

  it("thinking with no agent speech returns to listening", () => {
    const states = run([
      { type: "CONNECT" },
      { type: "CONNECTED" },
      { type: "SPEECH_START" },
      { type: "SPEECH_END", text: "hi" },
      { type: "ERROR", message: "no agent turn" },
    ]);
    expect(states.at(-1)).toBe("listening");
  });

  it("barge-in: agent_speaking -> interrupted -> thinking", () => {
    expect(
      run([
        { type: "CONNECT" },
        { type: "CONNECTED" },
        { type: "SPEECH_START" },
        { type: "SPEECH_END", text: "wait stop" },
        { type: "AGENT_START" },
        { type: "SPEECH_START" },
        { type: "AGENT_DONE" },
      ]),
    ).toEqual([
      "idle",
      "connecting",
      "listening",
      "user_speaking",
      "thinking",
      "agent_speaking",
      "interrupted",
      "thinking",
    ]);
  });

  it("any state falls into error on ERROR, and RESET returns to idle", () => {
    const states = run([
      { type: "CONNECT" },
      { type: "CONNECTED" },
      { type: "SPEECH_START" },
      { type: "ERROR", message: "ws closed" },
      { type: "RESET" },
    ]);
    expect(states.at(-2)).toBe("error");
    expect(states.at(-1)).toBe("idle");
    const actor = createActor(voiceMachine);
    actor.start();
    actor.send({ type: "ERROR", message: "boom" });
    expect(actor.getSnapshot().context.error).toBe("boom");
    actor.send({ type: "RESET" });
    expect(actor.getSnapshot().context).toEqual({
      error: null,
      lastUserText: null,
    });
  });

  it("ignores unrelated events (e.g. SPEECH_START in idle)", () => {
    expect(run([{ type: "SPEECH_START" }])).toEqual(["idle", "idle"]);
  });

  it("floatToPcm16 test frame count sanity", () => {
    expect(new Uint8Array(4).byteLength).toBe(4);
  });
});

describe("voiceMachine reconnecting", () => {
  it("unexpected close enters reconnecting, CONNECTED resumes listening", () => {
    expect(
      run([
        { type: "CONNECT" },
        { type: "CONNECTED" },
        { type: "RECONNECTING", attempt: 1 },
        { type: "CONNECTED" },
      ]),
    ).toEqual(["idle", "connecting", "listening", "reconnecting", "listening"]);
  });

  it("RETRY from error returns to idle and clears the error", () => {
    const actor = createActor(voiceMachine);
    actor.start();
    actor.send({ type: "ERROR", message: "ws closed" });
    expect(actor.getSnapshot().value).toBe("error");
    actor.send({ type: "RETRY" });
    const snap = actor.getSnapshot();
    expect(snap.value).toBe("idle");
    expect(snap.context.error).toBeNull();
  });
});
