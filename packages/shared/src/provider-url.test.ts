import { describe, expect, it } from "vitest";
import { anthropicMessagesUrl, providerEndpoint, trimBaseUrl } from "./provider-url";

describe("providerEndpoint", () => {
  it("trims trailing slashes and appends the path", () => {
    expect(providerEndpoint("https://openrouter.ai/api/v1/", "/models")).toBe(
      "https://openrouter.ai/api/v1/models",
    );
  });
  it("keeps arbitrary version segments untouched", () => {
    expect(providerEndpoint("https://api.z.ai/api/paas/v4", "/chat/completions")).toBe(
      "https://api.z.ai/api/paas/v4/chat/completions",
    );
    expect(
      providerEndpoint("https://generativelanguage.googleapis.com/v1beta/openai/", "models"),
    ).toBe("https://generativelanguage.googleapis.com/v1beta/openai/models");
  });
  it("never injects /v1 on a bare root", () => {
    expect(providerEndpoint("http://localhost:9000", "/models")).toBe(
      "http://localhost:9000/models",
    );
  });
  it("trims whitespace", () => {
    expect(trimBaseUrl("  http://x/v1/  ")).toBe("http://x/v1");
  });
});

describe("anthropicMessagesUrl", () => {
  it("adds /v1 to a bare host and does not double it", () => {
    expect(anthropicMessagesUrl("https://api.anthropic.com/")).toBe(
      "https://api.anthropic.com/v1/messages",
    );
    expect(anthropicMessagesUrl("https://api.anthropic.com/v1")).toBe(
      "https://api.anthropic.com/v1/messages",
    );
  });
});
