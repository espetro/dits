import { describe, expect, it } from "vitest";
import * as v from "valibot";
import {
  BrowserLlmSectionSchema,
  LlmSectionSchema,
  RemoteLlmSectionSchema,
  decodeLlmSection,
  decodeProviderProfile,
} from "./providers";

describe("llm section union", () => {
  it("parses a remote section", () => {
    const parsed = v.safeParse(LlmSectionSchema, {
      mode: "remote",
      baseUrl: "http://localhost:8317/v1",
      apiKey: "sk-x",
      model: "m1",
    });
    expect(parsed.success).toBe(true);
  });

  it("parses a browser section with engine and optional modelId", () => {
    expect(v.safeParse(LlmSectionSchema, { mode: "browser", engine: "gemini-nano" }).success).toBe(
      true,
    );
    expect(
      v.safeParse(LlmSectionSchema, {
        mode: "browser",
        engine: "transformers",
        modelId: "onnx-community/Qwen3-0.6B-ONNX",
      }).success,
    ).toBe(true);
  });

  it("rejects unknown engines and modes", () => {
    expect(v.safeParse(BrowserLlmSectionSchema, { mode: "browser", engine: "palm" }).success).toBe(
      false,
    );
    expect(
      v.safeParse(RemoteLlmSectionSchema, {
        mode: "cloud",
        baseUrl: "http://x/",
        apiKey: "k",
        model: "m",
      }).success,
    ).toBe(false);
  });

  it("decodeLlmSection migrates a legacy endpoint without mode", () => {
    const out = decodeLlmSection({
      baseUrl: "http://localhost:8317/v1",
      apiKey: "sk-x",
      model: "m1",
      flavor: "anthropic",
    });
    expect(out).toEqual({
      mode: "remote",
      baseUrl: "http://localhost:8317/v1",
      apiKey: "sk-x",
      model: "m1",
      flavor: "anthropic",
    });
  });

  it("decodeLlmSection passes through union members and drops junk", () => {
    expect(decodeLlmSection({ mode: "browser", engine: "transformers" })).toEqual({
      mode: "browser",
      engine: "transformers",
    });
    expect(decodeLlmSection({ mode: "nope" })).toBeNull();
    expect(decodeLlmSection("junk")).toBeNull();
  });

  it("decodeProviderProfile keeps a browser llm profile", () => {
    const raw = JSON.stringify({
      stt: { baseUrl: "http://a/", apiKey: "k", model: "w" },
      llm: { mode: "browser", engine: "gemini-nano" },
    });
    const out = decodeProviderProfile(raw);
    expect(out?.llm).toEqual({ mode: "browser", engine: "gemini-nano" });
  });

  it("decodeProviderProfile migrates legacy flat llm to remote mode", () => {
    const out = decodeProviderProfile(
      JSON.stringify({ baseUrl: "http://a/", apiKey: "k", llmModel: "m1" }),
    );
    expect(out?.llm).toMatchObject({ mode: "remote", model: "m1" });
  });
});
