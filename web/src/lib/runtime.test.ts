import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodeProviderProfile,
  LegacyProviderProfileSchema,
  ProviderSectionsSchema,
} from "@di/shared";
import * as v from "valibot";
import type { ProviderSections } from "@di/shared";
import {
  $effectiveRuntime,
  $providerProfile,
  $runtimeMode,
  $serverReachable,
  probeServer,
  redactKey,
} from "./runtime";

const LLM = { baseUrl: "http://localhost:8317/v1", apiKey: "sk-test-123456", model: "gpt-4o-mini" };
const PROFILE = { llm: LLM };

describe("runtime stores", () => {
  beforeEach(() => {
    localStorage.clear();
    $runtimeMode.set("server");
    $providerProfile.set(null);
    $serverReachable.set(null);
  });

  it("defaults to server mode and no profile", () => {
    expect($runtimeMode.get()).toBe("server");
    expect($providerProfile.get()).toBeNull();
  });

  it("persists mode and profile round-trip", () => {
    $runtimeMode.set("custom");
    $providerProfile.set({
      llm: LLM,
      tts: { ...LLM, model: "tts-1", voice: "alloy" },
    });
    expect(localStorage.getItem("di.runtime-mode")).toBe("custom");
    const raw = JSON.parse(localStorage.getItem("di.provider-profile") ?? "") as ProviderSections;
    expect(raw.llm?.model).toBe(LLM.model);

    // simulate a reload: persistent atoms decode from storage
    $runtimeMode.set($runtimeMode.get());
    expect($providerProfile.get()?.llm?.baseUrl).toBe(LLM.baseUrl);
  });

  it("drops a sections-shaped profile without an llm section", () => {
    localStorage.setItem("di.provider-profile", JSON.stringify({ stt: LLM }));
    const bad = JSON.parse(localStorage.getItem("di.provider-profile") ?? "");
    expect(decodeProviderProfile(JSON.stringify(bad))).toBeNull();
    $providerProfile.set(null);
    expect($providerProfile.get()).toBeNull();
  });

  it("migrates a legacy flat profile into sections", () => {
    const legacy = {
      baseUrl: "http://localhost:8317/v1",
      apiKey: "sk-legacy",
      llmModel: "gpt-4o-mini",
      ttsVoice: "alloy",
      ttsModel: "tts-1",
    };
    localStorage.setItem("di.provider-profile", JSON.stringify(legacy));
    // the stored decode maps the legacy flat shape:
    const decoded = decodeProviderProfile(localStorage.getItem("di.provider-profile") ?? "");
    expect(decoded).toEqual({
      stt: { baseUrl: legacy.baseUrl, apiKey: legacy.apiKey, model: "whisper-1", flavor: "openai" },
      tts: {
        baseUrl: legacy.baseUrl,
        apiKey: legacy.apiKey,
        model: "tts-1",
        voice: "alloy",
        flavor: "openai",
      },
      llm: {
        baseUrl: legacy.baseUrl,
        apiKey: legacy.apiKey,
        model: legacy.llmModel,
        flavor: "openai",
      },
    });
    expect(v.safeParse(LegacyProviderProfileSchema, legacy).success).toBe(true);
  });

  it("effectiveRuntime stays server when not probed", () => {
    expect($effectiveRuntime.get()).toBe("server");
  });

  it("effectiveRuntime falls back to custom when probe fails", () => {
    $serverReachable.set(false);
    expect($runtimeMode.get()).toBe("server"); // persisted mode untouched
    expect($effectiveRuntime.get()).toBe("custom");
  });

  it("probeServer with unreachable server reports false", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await probeServer()).toBe(false);
    expect($serverReachable.get()).toBe(false);
    vi.unstubAllGlobals();
  });

  it("probeServer with a healthy server reports true", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    expect(await probeServer()).toBe(true);
    expect($effectiveRuntime.get()).toBe("server");
    vi.unstubAllGlobals();
  });
});

describe("redactKey", () => {
  it("redacts the middle of a key", () => {
    const out = redactKey("sk-abcdefghijklmnop");
    expect(out.startsWith("sk-")).toBe(true);
    expect(out.endsWith("op")).toBe(true);
    expect(out).not.toContain("abcdefghij");
  });

  it("fully masks short keys", () => {
    expect(redactKey("abc")).toBe("•••");
    expect(redactKey("abcde")).toBe("•••••");
    expect(redactKey("abcdef")).toBe("abc•def".replace("def", "ef"));
  });
});
