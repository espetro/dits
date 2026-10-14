import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { relayActive, relayFetch } from "./relay";
import { $serverReachable } from "./runtime";

const DEMO_URL = "https://api.illo.fyi/v1";
const UPSTREAM = "https://api.openrouter.ai/v1/models";

vi.mock("./demo-llm", () => ({
  // static double: relayActive's demo exclusion is exercised against a
  // fixed demo base url, no env stubbing needed
  isDemoLlm: (baseUrl: string) =>
    baseUrl === DEMO_URL || baseUrl === `${DEMO_URL}/` || baseUrl.startsWith(DEMO_URL),
}));

function lastCall(): [RequestInfo | URL, RequestInit?] {
  const calls = vi.mocked(fetch).mock.calls;
  return calls[calls.length - 1]!;
}

describe("relayFetch", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    $serverReachable.set(null);
  });

  it("rewrites absolute https urls to the relay path", async () => {
    await relayFetch(UPSTREAM, { headers: { authorization: "Bearer k" } });
    const [input] = lastCall();
    expect(input).toBe(`/v1/relay?url=${encodeURIComponent(UPSTREAM)}`);
  });

  it("forwards only allowlisted headers (all header shapes)", async () => {
    await relayFetch(UPSTREAM, {
      headers: new Headers({
        authorization: "Bearer k",
        "content-type": "application/json",
        "cf-turnstile-response": "tok",
        "x-custom": "no",
        cookie: "secret=1",
      }),
    });
    let headers = lastCall()[1]?.headers as Record<string, string>;
    expect(headers).toEqual({
      authorization: "Bearer k",
      "content-type": "application/json",
      "cf-turnstile-response": "tok",
    });

    await relayFetch(UPSTREAM, {
      headers: [
        ["Authorization", "Bearer k2"],
        ["X-Custom", "dropped"],
      ],
    });
    headers = lastCall()[1]?.headers as Record<string, string>;
    expect(headers).toEqual({ authorization: "Bearer k2" });
  });

  it("sends no authorization header when the caller is keyless", async () => {
    await relayFetch(UPSTREAM, { headers: { "content-type": "application/json" } });
    const headers = lastCall()[1]?.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });

  it("passes relative urls through untouched", async () => {
    await relayFetch("/v1/x");
    const [input, init] = lastCall();
    expect(input).toBe("/v1/x");
    expect(String(init ?? "")).not.toContain("relay");
  });

  it("passes non-http(s) urls through untouched", async () => {
    await relayFetch("data:text/plain,hi");
    expect(lastCall()[0]).toBe("data:text/plain,hi");
  });

  it("forwards method, body and signal", async () => {
    const ctrl = new AbortController();
    await relayFetch(UPSTREAM, {
      method: "POST",
      body: '{"a":1}',
      signal: ctrl.signal,
    });
    const init = lastCall()[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"a":1}');
    expect(init.signal).toBe(ctrl.signal);
  });

  it("passes FormData through untouched and never forwards a content-type for it", async () => {
    const body = new FormData();
    body.set("file", new Blob([new Uint8Array(1_200_000)], { type: "audio/wav" }), "audio.wav");
    body.set("model", "whisper-1");
    await relayFetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { authorization: "Bearer k", "content-type": "multipart/form-data" },
      body,
    });
    const init = lastCall()[1] as RequestInit;
    expect(init.body).toBe(body);
    expect(init.headers).toEqual({ authorization: "Bearer k" });
  });

  it("sends FormData with no content-type when the caller sets none", async () => {
    const body = new FormData();
    body.set("model", "m");
    await relayFetch(UPSTREAM, { method: "POST", body });
    const init = lastCall()[1] as RequestInit;
    expect(init.body).toBe(body);
    expect(init.headers).toEqual({});
  });

  it("defaults to GET when no method is given", async () => {
    await relayFetch(UPSTREAM);
    expect(lastCall()[1]?.method).toBeUndefined();
  });
});

describe("relayActive", () => {
  afterEach(() => $serverReachable.set(null));

  it("is false while $serverReachable is null or false", () => {
    $serverReachable.set(null);
    expect(relayActive("https://api.openrouter.ai/v1")).toBe(false);
    $serverReachable.set(false);
    expect(relayActive("https://api.openrouter.ai/v1")).toBe(false);
  });

  it("is true when reachable and the endpoint is not the demo", () => {
    $serverReachable.set(true);
    expect(relayActive("https://api.openrouter.ai/v1")).toBe(true);
    expect(relayActive("http://localhost:8317/v1")).toBe(true);
  });

  it("is false for the demo endpoint even when reachable", () => {
    $serverReachable.set(true);
    expect(relayActive(DEMO_URL)).toBe(false);
  });
});
