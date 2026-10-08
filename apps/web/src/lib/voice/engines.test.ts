import { describe, expect, it } from "vitest";
import { resolveVoiceEngines } from "./engines";
import type { VoiceEngineInput } from "./engines";

const base: VoiceEngineInput = {
  sttPick: "wasm",
  ttsPick: "wasm",
  consent: "granted",
  sttReady: true,
  ttsReady: true,
  supported: true,
  hasTtsEndpoint: false,
  hasSttEndpoint: false,
};

describe("resolveVoiceEngines", () => {
  it("resolves wasm when consented, downloaded and supported", () => {
    expect(resolveVoiceEngines(base)).toEqual({ stt: "wasm", tts: "wasm" });
  });

  it("auto picks take the wasm-first chain when on-device is ready", () => {
    expect(resolveVoiceEngines({ ...base, sttPick: "", ttsPick: "" })).toEqual({
      stt: "wasm",
      tts: "wasm",
    });
  });

  it("a degraded server pick follows the same auto chain", () => {
    expect(resolveVoiceEngines({ ...base, sttPick: "server", ttsPick: "server" })).toEqual({
      stt: "wasm",
      tts: "wasm",
    });
  });

  it("falls back per engine when consent or downloads are missing", () => {
    for (const consent of ["declined", ""]) {
      expect(resolveVoiceEngines({ ...base, consent })).toEqual({
        stt: "builtin",
        tts: "builtin",
      });
    }
    expect(resolveVoiceEngines({ ...base, sttReady: false })).toEqual({
      stt: "builtin",
      tts: "wasm",
    });
    expect(resolveVoiceEngines({ ...base, ttsReady: false })).toEqual({
      stt: "wasm",
      tts: "builtin",
    });
  });

  it("never picks wasm when wasm/simd is unsupported", () => {
    expect(resolveVoiceEngines({ ...base, supported: false })).toEqual({
      stt: "builtin",
      tts: "builtin",
    });
  });

  it("honors explicit in-browser picks even when on-device is ready", () => {
    expect(resolveVoiceEngines({ ...base, sttPick: "in-browser", ttsPick: "in-browser" })).toEqual({
      stt: "builtin",
      tts: "builtin",
    });
  });

  it("cloud pick without a configured endpoint falls back to builtin", () => {
    expect(resolveVoiceEngines({ ...base, ttsPick: "cloud" })).toEqual({
      stt: "wasm",
      tts: "builtin",
    });
    expect(resolveVoiceEngines({ ...base, sttPick: "cloud" })).toEqual({
      stt: "builtin",
      tts: "wasm",
    });
  });

  it("cloud pick with a configured endpoint wins", () => {
    expect(resolveVoiceEngines({ ...base, ttsPick: "cloud", hasTtsEndpoint: true })).toEqual({
      stt: "wasm",
      tts: "endpoint",
    });
    expect(resolveVoiceEngines({ ...base, sttPick: "cloud", hasSttEndpoint: true })).toEqual({
      stt: "endpoint",
      tts: "wasm",
    });
  });

  it("unset tts pick prefers a configured endpoint over builtin when wasm is not ready", () => {
    expect(
      resolveVoiceEngines({ ...base, ttsPick: "", ttsReady: false, hasTtsEndpoint: true }),
    ).toEqual({
      stt: "wasm",
      tts: "endpoint",
    });
    expect(resolveVoiceEngines({ ...base, ttsPick: "", ttsReady: false })).toEqual({
      stt: "wasm",
      tts: "builtin",
    });
  });

  it("explicit wasm pick not installed falls to builtin (status pane shows the gap)", () => {
    expect(resolveVoiceEngines({ ...base, ttsReady: false, hasTtsEndpoint: true })).toEqual({
      stt: "wasm",
      tts: "builtin",
    });
  });
});
