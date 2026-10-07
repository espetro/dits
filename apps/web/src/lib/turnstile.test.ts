import { beforeEach, describe, expect, it, vi } from "vitest";

const DEMO_URL = "https://api.illo.fyi/v1";
const BYO_URL = "https://byo.example.com/v1";

interface FakeParams {
  callback: (token: string) => void;
  "error-callback": () => void;
  "timeout-callback": () => void;
  "expired-callback": () => void;
  sitekey: string;
}

/** Minimal window.turnstile double: render captures params, execute resolves. */
function fakeApi() {
  const params: FakeParams[] = [];
  const api = {
    render: vi.fn((_c: HTMLElement, p: FakeParams) => {
      params.push(p);
      return "w1";
    }),
    execute: vi.fn(() => params[0]!.callback("test-token")),
    reset: vi.fn(),
  };
  return { api, params };
}

async function freshModule(siteKey?: string) {
  vi.resetModules();
  if (siteKey === undefined) {
    vi.unstubAllEnvs();
  } else {
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", siteKey);
  }
  vi.stubEnv("VITE_DEMO_LLM_BASE_URL", DEMO_URL);
  return import("./turnstile");
}

describe("turnstileTokenFor", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    delete window.turnstile;
  });

  it("returns null for non-demo endpoints and never loads api.js", async () => {
    const mod = await freshModule();
    expect(await mod.turnstileTokenFor(BYO_URL)).toBeNull();
    expect(document.head.querySelectorAll("script")).toHaveLength(0);
    expect(document.body.children).toHaveLength(0);
  });

  it("executes per request and resets the single-use token", async () => {
    const mod = await freshModule();
    const { api } = fakeApi();
    window.turnstile = api;
    expect(await mod.turnstileTokenFor(DEMO_URL)).toBe("test-token");
    expect(api.execute).toHaveBeenCalledWith("w1");
    expect(api.reset).toHaveBeenCalledWith("w1");
    // a second request executes again: tokens are single-use
    expect(await mod.turnstileTokenFor(DEMO_URL)).toBe("test-token");
    expect(api.execute).toHaveBeenCalledTimes(2);
    expect(api.render).toHaveBeenCalledTimes(1);
  });

  it("rejects when the challenge errors", async () => {
    const mod = await freshModule();
    const { api, params } = fakeApi();
    api.execute = vi.fn(() => params[0]!["error-callback"]());
    window.turnstile = api;
    await expect(mod.turnstileTokenFor(DEMO_URL)).rejects.toThrow("turnstile challenge failed");
  });

  it("returns null when the sitekey env is empty", async () => {
    const mod = await freshModule("");
    expect(await mod.turnstileTokenFor(DEMO_URL)).toBeNull();
  });

  it("falls back to the demo sitekey when the env is unset", async () => {
    const mod = await freshModule();
    expect(mod.TURNSTILE_SITE_KEY).toBe("0x4AAAAAAFQYyuFKwM_ZZ7R3");
  });
});
