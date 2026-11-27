import { describe, expect, it } from "vitest";
import { PROVIDER_PRESETS, presetForBaseUrl } from "./provider-presets";
import { providerEndpoint } from "./provider-url";

describe("provider presets", () => {
  it("keeps each version path in the base url", () => {
    expect(
      providerEndpoint(presetForBaseUrl("https://openrouter.ai/api/v1/")!.baseUrl, "/models"),
    ).toBe("https://openrouter.ai/api/v1/models");
    expect(presetForBaseUrl("https://api.z.ai/api/paas/v4")?.id).toBe("zai");
  });

  it("has unique ids and parseable urls", () => {
    expect(new Set(PROVIDER_PRESETS.map((p) => p.id)).size).toBe(PROVIDER_PRESETS.length);
    for (const p of PROVIDER_PRESETS) expect(URL.canParse(p.baseUrl)).toBe(true);
  });

  it("returns undefined for unknown urls", () => {
    expect(presetForBaseUrl("http://localhost:8317/v1")).toBeUndefined();
  });
});
