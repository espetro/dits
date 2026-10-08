import { beforeEach, describe, expect, it } from "vitest";
import { $seamHealth, $seamOps, chipState, markDriverError, markSeamOp } from "./seam-health";
import { $providerProfile, $serverReachable } from "./runtime";
import { $voiceModelsConsent, $voiceSttEngine, $voiceTtsEngine } from "../stores/voice";

const LLM = {
  mode: "remote" as const,
  baseUrl: "http://localhost:8317/v1",
  apiKey: "sk-test",
  model: "gpt-4o-mini",
};

describe("seam health", () => {
  beforeEach(() => {
    localStorage.clear();
    // jsdom lacks the browser speech apis — stub them so the in-browser
    // chain resolves "up"
    (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = function () {};
    (globalThis as unknown as { speechSynthesis?: unknown }).speechSynthesis = {};
    $seamOps.set({});
    $voiceSttEngine.set("");
    $voiceTtsEngine.set("");
    $voiceModelsConsent.set("");
    $providerProfile.set(null);
    $serverReachable.set(null);
  });

  it("auto picks on the di server are up", () => {
    $serverReachable.set(true);
    const h = $seamHealth.get();
    expect(h.stt.state).toBe("up");
    expect(h.tts.state).toBe("up");
    expect(h.llm.state).toBe("up");
    expect(chipState(h)).toBe("ok");
  });

  it("explicit server pick unreachable is down", () => {
    $voiceSttEngine.set("server");
    $serverReachable.set(false);
    const h = $seamHealth.get();
    expect(h.stt.state).toBe("down");
    expect(h.stt.reason).toBe("server.unreachable");
  });

  it("cloud pick without an endpoint is down", () => {
    $voiceTtsEngine.set("cloud");
    const h = $seamHealth.get();
    expect(h.tts.state).toBe("down");
    expect(h.tts.reason).toBe("tts.noEndpoint");
  });

  it("cloud pick with an endpoint is up", () => {
    $providerProfile.set({ llm: LLM, tts: { ...LLM, model: "tts-1", voice: "alloy" } });
    $voiceTtsEngine.set("cloud");
    expect($seamHealth.get().tts.state).toBe("up");
  });

  it("browser-driven without an llm is llm down", () => {
    $serverReachable.set(false); // browser driver
    const h = $seamHealth.get();
    expect(h.llm.state).toBe("down");
    expect(h.llm.reason).toBe("llm.unconfigured");
  });

  it("a last-op error sinks an otherwise healthy seam", () => {
    $serverReachable.set(false);
    $providerProfile.set({ llm: LLM });
    markSeamOp("llm", false, "voice.llm");
    const h = $seamHealth.get();
    expect(h.llm.state).toBe("down");
    expect(h.llm.reason).toBe("voice.llm");
  });

  it("the next success clears a sunk seam", () => {
    $serverReachable.set(false);
    $providerProfile.set({ llm: LLM });
    markSeamOp("tts", false, "voice.tts");
    expect($seamHealth.get().tts.state).toBe("down");
    markSeamOp("tts", true);
    expect($seamHealth.get().tts.state).toBe("up");
  });

  it("driver error codes map to seams", () => {
    markDriverError("voice.micDenied");
    markDriverError("voice.tts");
    markDriverError("voice.noResponse");
    const ops = $seamOps.get();
    expect(ops.stt?.reason).toBe("voice.micDenied");
    expect(ops.tts?.reason).toBe("voice.tts");
    expect(ops.llm?.reason).toBe("voice.noResponse");
  });

  it("server-pipeline errors sink all three seams", () => {
    markDriverError("voice.server");
    const ops = $seamOps.get();
    expect(ops.stt?.ok).toBe(false);
    expect(ops.tts?.ok).toBe(false);
    expect(ops.llm?.ok).toBe(false);
  });

  it("chipState aggregates: one down names it, two are unstable, three offline", () => {
    $serverReachable.set(false);
    $providerProfile.set({ llm: LLM });
    $voiceSttEngine.set("in-browser");
    $voiceTtsEngine.set("cloud"); // no tts endpoint -> down
    let state = chipState($seamHealth.get());
    expect(state).toEqual({ down: ["tts"] });

    markSeamOp("stt", false, "voice.stt");
    state = chipState($seamHealth.get());
    expect(state).toEqual({ down: ["stt", "tts"] });

    markSeamOp("llm", false, "voice.llm");
    state = chipState($seamHealth.get());
    expect(state).toBe("offline");
  });

  it("re-picking a layer clears its stale op error", () => {
    $serverReachable.set(false);
    $providerProfile.set({ llm: LLM });
    markSeamOp("stt", false, "voice.stt");
    $voiceSttEngine.set("in-browser");
    expect($seamOps.get().stt).toBeUndefined();
  });
});
