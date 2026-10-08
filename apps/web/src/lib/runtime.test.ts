import { beforeEach, describe, expect, it, vi } from "vitest";
import { LegacyProviderProfileSchema, decodeProviderProfile } from "@di/shared";
import * as v from "valibot";
import {
  $providerProfile,
  $serverDriven,
  $serverReachable,
  pickWantsServer,
  probeServer,
  redactKey,
} from "./runtime";
import { $voiceSttEngine, $voiceTtsEngine } from "../stores/voice";

const LLM = {
  mode: "remote" as const,
  baseUrl: "http://localhost:8317/v1",
  apiKey: "sk-test-123456",
  model: "gpt-4o-mini",
};
describe("runtime stores", () => {
  beforeEach(() => {
    localStorage.clear();
    $voiceSttEngine.set("");
    $voiceTtsEngine.set("");
    $providerProfile.set(null);
    $serverReachable.set(null);
  });

  it("defaults to auto picks and no profile", () => {
    expect($voiceSttEngine.get()).toBe("");
    expect($voiceTtsEngine.get()).toBe("");
    expect($providerProfile.get()).toBeNull();
  });

  it("persists the profile round-trip", () => {
    $providerProfile.set({
      llm: LLM,
      tts: { ...LLM, model: "tts-1", voice: "alloy" },
    });
    const raw = JSON.parse(localStorage.getItem("di.provider-profile") ?? "") as {
      llm?: { mode: string; model?: string };
    };
    expect(raw.llm?.model).toBe(LLM.model);
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
        mode: "remote",
      },
    });
    expect(v.safeParse(LegacyProviderProfileSchema, legacy).success).toBe(true);
  });

  it("serverDriven is optimistic until the probe disproves it", () => {
    // auto picks + not yet probed: assume the di server hosts the app
    expect($serverDriven.get()).toBe(true);
  });

  it("serverDriven falls to browser when the probe fails", () => {
    $serverReachable.set(false);
    expect($serverDriven.get()).toBe(false);
  });

  it("a browser-side pick on either seam drops serverDriven", () => {
    $serverReachable.set(true);
    $voiceSttEngine.set("wasm");
    expect($serverDriven.get()).toBe(false);
    $voiceTtsEngine.set("in-browser");
    $voiceSttEngine.set("");
    expect($serverDriven.get()).toBe(false);
  });

  it("explicit server picks stay server-driven when reachable", () => {
    $voiceSttEngine.set("server");
    $voiceTtsEngine.set("server");
    $serverReachable.set(true);
    expect($serverDriven.get()).toBe(true);
  });

  it("pickWantsServer treats auto and server picks as server-side", () => {
    expect(pickWantsServer("")).toBe(true);
    expect(pickWantsServer("server")).toBe(true);
    expect(pickWantsServer("wasm")).toBe(false);
    expect(pickWantsServer("in-browser")).toBe(false);
    expect(pickWantsServer("cloud")).toBe(false);
  });

  it("probeServer with unreachable server reports false", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await probeServer()).toBe(false);
    expect($serverReachable.get()).toBe(false);
    vi.unstubAllGlobals();
  });

  function healthResponse(body: unknown, contentType = "application/json") {
    return {
      ok: true,
      headers: new Headers({ "content-type": contentType }),
      json: async () => body,
    };
  }

  it("probeServer with a healthy server reports true", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(healthResponse({ ok: true })));
    expect(await probeServer()).toBe(true);
    expect($serverDriven.get()).toBe(true);
    vi.unstubAllGlobals();
  });

  it("probeServer rejects an SPA-fallback 200 that serves html", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(healthResponse("<html></html>", "text/html")));
    expect(await probeServer()).toBe(false);
    expect($serverReachable.get()).toBe(false);
    vi.unstubAllGlobals();
  });

  it("probeServer rejects a json 200 without ok:true", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(healthResponse({ status: "up" })));
    expect(await probeServer()).toBe(false);
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
