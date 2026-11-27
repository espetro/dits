import { describe, expect, it } from "vitest";
import type { Config } from "@di/shared";
import { sttProviderOf, ttsProviderOf } from "../voice/providers";
import { resolveProviderConfig } from "./resolve-provider-settings";

const baseConfig: Config = {
  server: { port: 8080, auth: "none" },
  llm: {
    provider: "mock",
    base_url: "http://localhost:9000/v1",
    api_key: "base-llm-key",
    model: "base-chat",
    flavor: "openai",
    reasoning_exclude: false,
    thinking_disabled: false,
    max_tokens: 800,
  },
  stt: {
    base_url: "http://localhost:9000/v1",
    api_key: "base-stt-key",
    model: "base-stt",
    mode: "buffered",
  },
  tts: {
    base_url: "http://localhost:9000/v1",
    api_key: "base-tts-key",
    model: "base-tts",
    voice: "base-voice",
  },
  files: { db_path: "data/di.db", log_path: "data/di.log", data_dir: "data" },
};

describe("resolveProviderConfig", () => {
  it("derives the initial effective config from yaml/env when no settings exist", () => {
    const resolved = resolveProviderConfig(baseConfig, null);
    expect(resolved.llm).toEqual(baseConfig.llm);
    expect(resolved.stt).toEqual(baseConfig.stt);
    expect(resolved.tts).toEqual(baseConfig.tts);
  });

  it("treats an empty settings document as no overrides", () => {
    expect(resolveProviderConfig(baseConfig, {})).toEqual({
      llm: baseConfig.llm,
      stt: baseConfig.stt,
      tts: baseConfig.tts,
    });
  });

  it("merges partial field overrides without dropping inherited config", () => {
    const resolved = resolveProviderConfig(baseConfig, {
      llm: { model: "saved-chat", reasoning_exclude: true },
      stt: { model: "saved-stt" },
      tts: { voice: "saved-voice" },
    });

    expect(resolved.llm).toEqual({
      ...baseConfig.llm,
      model: "saved-chat",
      reasoning_exclude: true,
    });
    expect(resolved.llm.api_key).toBe("base-llm-key");
    expect(resolved.stt).toEqual({ ...baseConfig.stt, model: "saved-stt" });
    expect(resolved.tts).toEqual({ ...baseConfig.tts, voice: "saved-voice" });
  });

  it("null suppresses inherited optional values", () => {
    const resolved = resolveProviderConfig(baseConfig, {
      llm: { api_key: null, max_tokens: null },
      stt: { api_key: null },
      tts: { voice: null },
    });

    expect(resolved.llm.api_key).toBeUndefined();
    expect(resolved.llm.max_tokens).toBeUndefined();
    expect("api_key" in resolved.llm).toBe(false);
    expect(resolved.stt.api_key).toBeUndefined();
    expect(resolved.tts.voice).toBeUndefined();
  });

  it("clearing an inherited endpoint can return voice to the builtin provider shape", () => {
    const resolved = resolveProviderConfig(baseConfig, {
      stt: { base_url: null },
      tts: { base_url: null },
    });

    expect(resolved.stt.base_url).toBeUndefined();
    expect(resolved.tts.base_url).toBeUndefined();
    expect(sttProviderOf(resolved.stt)).toBe("builtin");
    expect(ttsProviderOf(resolved.tts)).toBe("builtin");
  });

  it("an explicit provider override wins over shape inference from inherited fields", () => {
    const resolved = resolveProviderConfig(baseConfig, {
      stt: { provider: "builtin" },
      tts: { provider: "builtin" },
    });

    expect(resolved.stt.base_url).toBe(baseConfig.stt.base_url);
    expect(sttProviderOf(resolved.stt)).toBe("builtin");
    expect(ttsProviderOf(resolved.tts)).toBe("builtin");
  });

  it("does not mutate the base config or settings input", () => {
    const settings = {
      llm: { model: "saved-chat" },
      tts: { voice: null },
    };
    const resolved = resolveProviderConfig(baseConfig, settings);

    expect(resolved.llm).not.toBe(baseConfig.llm);
    expect(baseConfig.llm.model).toBe("base-chat");
    expect(baseConfig.tts.voice).toBe("base-voice");
    expect(settings).toEqual({ llm: { model: "saved-chat" }, tts: { voice: null } });
  });
});
