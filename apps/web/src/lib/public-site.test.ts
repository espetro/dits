import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DEMO_URL = "https://demo.example/v1";

async function importRuntime() {
  vi.resetModules();
  return import("./runtime");
}

describe("public-site runtime", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubEnv("VITE_DEMO_LLM_BASE_URL", DEMO_URL);
    vi.stubEnv("VITE_DEMO_LLM_API_KEY", "");
    vi.stubEnv("VITE_DEMO_LLM_MODEL", "demo-model");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("preselects the demo llm as the zero-conf profile", async () => {
    localStorage.setItem("di.public-site", "1");
    const runtime = await importRuntime();
    const expected = {
      llm: {
        mode: "remote",
        baseUrl: DEMO_URL,
        apiKey: "",
        model: "demo-model",
        flavor: "openai",
      },
    };
    expect(runtime.defaultProviderProfile()).toEqual(expected);
    expect(runtime.$providerProfile.get()).toEqual(expected);
  });

  it("is client-only without probing the static origin", async () => {
    localStorage.setItem("di.public-site", "1");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const runtime = await importRuntime();

    expect(runtime.$serverDriven.get()).toBe(false);
    expect(await runtime.probeServer()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
