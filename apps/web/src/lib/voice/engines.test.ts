import { describe, expect, it } from "vitest";
import { resolveVoiceEngines } from "./engines";
import type { VoiceEngineInput } from "./engines";

const base: VoiceEngineInput = {
  sttPick: "on-device",
  ttsPick: "on-device",
  consent: "granted",
  sttReady: true,
  ttsReady: true,
  supported: true,
  hasTtsEndpoint: false,
};

describe("resolveVoiceEngines", () => {
  it("resolves wasm when consented, downloaded and supported", () => {
    expect(resolveVoiceEngines(base)).toEqual({ stt: "wasm", tts: "wasm" });
  });

  it("falls back to builtin without consent", () => {
    for (const consent of ["declined", ""]) {
      expect(resolveVoiceEngines({ ...base, consent })).toEqual({
        stt: "builtin",
        tts: "builtin",
      });
    }
  });

  it("falls back per engine when only one model is downloaded", () => {
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

  it("honors explicit builtin picks even when on-device is ready", () => {
    expect(resolveVoiceEngines({ ...base, sttPick: "builtin", ttsPick: "builtin" })).toEqual({
      stt: "builtin",
      tts: "builtin",
    });
  });

  it("endpoint pick without a configured endpoint falls back to builtin", () => {
    expect(resolveVoiceEngines({ ...base, ttsPick: "endpoint" })).toEqual({
      stt: "wasm",
      tts: "builtin",
    });
  });

  it("endpoint pick with a configured endpoint wins", () => {
    expect(resolveVoiceEngines({ ...base, ttsPick: "endpoint", hasTtsEndpoint: true })).toEqual({
      stt: "wasm",
      tts: "endpoint",
    });
  });

  it("unset tts pick defaults to endpoint when one is configured (pre-wasm behavior)", () => {
    expect(resolveVoiceEngines({ ...base, ttsPick: "", hasTtsEndpoint: true })).toEqual({
      stt: "wasm",
      tts: "endpoint",
    });
    expect(resolveVoiceEngines({ ...base, ttsPick: "" })).toEqual({
      stt: "wasm",
      tts: "wasm",
    });
  });

  it("on-device pick not ready prefers the configured endpoint over builtin", () => {
    expect(resolveVoiceEngines({ ...base, ttsReady: false, hasTtsEndpoint: true })).toEqual({
      stt: "wasm",
      tts: "endpoint",
    });
  });
});
