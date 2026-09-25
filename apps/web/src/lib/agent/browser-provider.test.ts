import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRANSFORMERS_MODEL_ID,
  TRANSFORMERS_CATALOG,
  createLlmModel,
  isBrowserLlm,
  isRemoteLlm,
  transformersModelInstalled,
} from "./browser-provider";

describe("browser provider seam", () => {
  it("classifies sections", () => {
    expect(isRemoteLlm({ mode: "remote", baseUrl: "http://x/", apiKey: "k", model: "m" })).toBe(
      true,
    );
    expect(isBrowserLlm({ mode: "browser", engine: "gemini-nano" })).toBe(true);
    expect(isRemoteLlm(undefined)).toBe(false);
  });

  it("builds a remote model", () => {
    const built = createLlmModel({
      mode: "remote",
      baseUrl: "http://localhost:8317/v1",
      apiKey: "sk-x",
      model: "m1",
    });
    expect(built?.browser).toBeUndefined();
    expect(built?.model).toBeTruthy();
  });

  it("returns null for a browser engine the environment cannot serve", () => {
    // jsdom: no Prompt API global, no navigator.gpu.
    const built = createLlmModel({ mode: "browser", engine: "gemini-nano" });
    expect(built).toBeNull();
  });

  it("transformers handles are lazy: model access before load throws", () => {
    const tf = createLlmModel({ mode: "browser", engine: "transformers" });
    expect(tf?.browser).toBeTruthy();
    expect(() => tf!.browser!.model).toThrow(/not loaded/);
  });

  it("catalog contains the default model with a size hint", () => {
    expect(
      TRANSFORMERS_CATALOG.some((m) => m.id === DEFAULT_TRANSFORMERS_MODEL_ID && m.sizeMb > 0),
    ).toBe(true);
  });

  it("installed probe is false without a cache", async () => {
    const installed = await transformersModelInstalled("some/model");
    expect(installed).toBe(false);
  });
});
