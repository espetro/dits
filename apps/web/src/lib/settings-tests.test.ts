import { beforeEach, describe, expect, it, vi } from "vitest";
import { turnstileTokenFor } from "./turnstile";
import { probeModels } from "./settings-tests";

vi.mock("./turnstile", () => ({ turnstileTokenFor: vi.fn(async () => "ts-tok") }));

const DRAFT = { baseUrl: "https://api.example.com/v1", apiKey: "", model: "m1" };

describe("probeModels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
  });

  it("skips turnstile when an apiKey is configured", async () => {
    await probeModels({ ...DRAFT, apiKey: "dev-key" });
    expect(turnstileTokenFor).not.toHaveBeenCalled();
    const headers = vi.mocked(fetch).mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers["cf-turnstile-response"]).toBeUndefined();
    expect(headers.authorization).toBe("Bearer dev-key");
  });

  it("fetches a turnstile token on keyless probes", async () => {
    await probeModels(DRAFT);
    expect(turnstileTokenFor).toHaveBeenCalledWith(DRAFT.baseUrl);
    const headers = vi.mocked(fetch).mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers["cf-turnstile-response"]).toBe("ts-tok");
    expect(headers.authorization).toBeUndefined();
  });
});
