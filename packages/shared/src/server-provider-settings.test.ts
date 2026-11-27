import { describe, expect, it } from "vitest";
import * as v from "valibot";
import {
  RedactedServerProviderSettingsSchema,
  ServerProviderSettingsSchema,
  redactServerProviderSettings,
} from "./server-provider-settings";

const SECRET = "sk-test-super-secret";

const validSettings = {
  llm: {
    provider: "openai",
    base_url: "https://api.openai.com/v1",
    api_key: SECRET,
    model: "gpt-4.1-mini",
    flavor: "openai",
    reasoning_exclude: true,
    thinking_disabled: false,
    max_tokens: 900,
  },
  stt: {
    provider: "remote",
    base_url: "http://localhost:9000/v1",
    api_key: SECRET,
    model: "whisper-1",
    mode: "streaming",
  },
  tts: {
    provider: "remote",
    base_url: "http://localhost:9000/v1",
    api_key: SECRET,
    model: "tts-1",
    voice: "alloy",
  },
  embeddings: {
    base_url: "http://localhost:9000/v1",
    api_key: SECRET,
    model: "embed-1",
  },
} as const;

describe("ServerProviderSettingsSchema", () => {
  it("accepts sparse settings for llm, stt, tts and embeddings", () => {
    const parsed = v.safeParse(ServerProviderSettingsSchema, validSettings);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.output.llm?.api_key).toBe(SECRET);
      expect(parsed.output.embeddings?.model).toBe("embed-1");
    }
  });

  it("accepts partial overrides and explicit null clears", () => {
    const parsed = v.safeParse(ServerProviderSettingsSchema, {
      llm: { model: "different", api_key: null, max_tokens: null },
      stt: { base_url: null },
      tts: { voice: null },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.output.llm?.model).toBe("different");
      expect(parsed.output.llm?.api_key).toBeNull();
      expect(parsed.output.stt?.base_url).toBeNull();
    }
  });

  it("coerces boolean-like provider flags the same way config does", () => {
    const parsed = v.parse(ServerProviderSettingsSchema, {
      llm: { reasoning_exclude: "true", thinking_disabled: "false" },
    });
    expect(parsed.llm?.reasoning_exclude).toBe(true);
    expect(parsed.llm?.thinking_disabled).toBe(false);
  });

  it("rejects invalid urls, providers and token caps", () => {
    expect(
      v.safeParse(ServerProviderSettingsSchema, { llm: { base_url: "not a url" } }).success,
    ).toBe(false);
    expect(
      v.safeParse(ServerProviderSettingsSchema, { llm: { provider: "bedrock" } }).success,
    ).toBe(false);
    expect(v.safeParse(ServerProviderSettingsSchema, { llm: { max_tokens: 0 } }).success).toBe(
      false,
    );
    expect(v.safeParse(ServerProviderSettingsSchema, { stt: { mode: "stream" } }).success).toBe(
      false,
    );
  });

  it("does not allow null for llm identity fields", () => {
    expect(v.safeParse(ServerProviderSettingsSchema, { llm: { base_url: null } }).success).toBe(
      false,
    );
    expect(v.safeParse(ServerProviderSettingsSchema, { llm: { model: null } }).success).toBe(false);
    expect(v.safeParse(ServerProviderSettingsSchema, { llm: { provider: null } }).success).toBe(
      false,
    );
  });
});

describe("redactServerProviderSettings", () => {
  it("removes every raw api key and exposes only key presence", () => {
    const settings = v.parse(ServerProviderSettingsSchema, validSettings);
    const redacted = redactServerProviderSettings(settings);

    expect(redacted.llm?.api_key_set).toBe(true);
    expect(redacted.stt?.api_key_set).toBe(true);
    expect(redacted.tts?.api_key_set).toBe(true);
    expect(redacted.embeddings?.api_key_set).toBe(true);
    expect(JSON.stringify(redacted)).not.toContain(SECRET);
    expect(JSON.stringify(redacted)).not.toContain('"api_key"');
    expect(v.safeParse(RedactedServerProviderSettingsSchema, redacted).success).toBe(true);
  });

  it("marks absent, null and empty keys as not set without inventing fields", () => {
    const redacted = redactServerProviderSettings({
      llm: { model: "gpt" },
      stt: { api_key: null },
      tts: { api_key: "" },
    });
    expect(redacted.llm?.api_key_set).toBe(false);
    expect(redacted.stt?.api_key_set).toBe(false);
    expect(redacted.tts?.api_key_set).toBe(false);
    expect(redacted.embeddings).toBeUndefined();
  });

  it("preserves non-secret null-clear markers", () => {
    const redacted = redactServerProviderSettings({
      llm: { max_tokens: null },
      stt: { base_url: null },
      tts: { voice: null },
    });
    expect(redacted.llm?.max_tokens).toBeNull();
    expect(redacted.stt?.base_url).toBeNull();
    expect(redacted.tts?.voice).toBeNull();
  });
});
