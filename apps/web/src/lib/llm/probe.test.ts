import { beforeEach, describe, expect, it, vi } from "vitest";
import { turnstileTokenFor } from "../turnstile";
import { DiError } from "../errors";
import { $serverReachable } from "../runtime";
import { LlmTestError, probeModels, runLlmTest } from "./probe";

vi.mock("../turnstile", () => ({ turnstileTokenFor: vi.fn(async () => "ts-tok") }));

const LIST = JSON.stringify({ data: [{ id: "b" }, { id: "a" }] });
const json = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { "content-type": "application/json" } });
const html = (status = 200): Response =>
  new Response("<!doctype html><html></html>", {
    status,
    headers: { "content-type": "text/html" },
  });

const DRAFT = { baseUrl: "https://api.example.com/v1", apiKey: "", model: "m1" };

describe("probeModels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // a settled probe: no health call in the way of the assertions below
    $serverReachable.set(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(LIST)),
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

  it("returns sorted ids and uses the base url verbatim (no /v1 injection)", async () => {
    const ids = await probeModels({
      ...DRAFT,
      baseUrl: "https://api.z.ai/api/paas/v4/",
      apiKey: "k",
    });
    expect(ids).toEqual(["a", "b"]);
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("https://api.z.ai/api/paas/v4/models");
  });

  it("surfaces non-ok statuses as an http DiError", async () => {
    vi.mocked(fetch).mockResolvedValue(json("{}", 401));
    const err = await probeModels({ ...DRAFT, apiKey: "k" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DiError);
    expect(err).toMatchObject({ code: "http", params: { status: 401 } });
  });

  it("rejects a json body without a model list", async () => {
    vi.mocked(fetch).mockResolvedValue(json('{"ok":true}'));
    await expect(probeModels({ ...DRAFT, apiKey: "k" })).rejects.toMatchObject({
      code: "models.shape",
    });
  });

  it("reports html 200 as not-json and suggests a working base url", async () => {
    vi.mocked(fetch).mockImplementation(async (input) =>
      String(input) === "https://openrouter.ai/api/v1/models" ? json(LIST) : html(),
    );
    await expect(
      probeModels({ ...DRAFT, baseUrl: "https://openrouter.ai/", apiKey: "k" }),
    ).rejects.toMatchObject({
      code: "models.suggest",
      params: { url: "https://openrouter.ai/api/v1" },
    });
  });

  it("falls back to the plain error when no candidate works", async () => {
    vi.mocked(fetch).mockImplementation(async () => html());
    await expect(probeModels({ ...DRAFT, apiKey: "k" })).rejects.toMatchObject({
      code: "models.notJson",
    });
  });

  it("maps fetch rejections to a network error", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(probeModels({ ...DRAFT, apiKey: "k" })).rejects.toMatchObject({
      code: "models.network",
    });
  });
});

const sse = (chunks: unknown[]): Response =>
  new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", {
    headers: { "content-type": "text/event-stream" },
  });

const HEALTH_OK = (): Response => json(JSON.stringify({ ok: true }));
const isHealth = (url: unknown): boolean => String(url).endsWith("/api/health");
const isChat = (url: unknown): boolean => !isHealth(url);

/** Route fetch by url: health answered by `health`, everything else by `chat`. */
function stubFetch(
  health: () => Response | Promise<Response>,
  chat: () => Response | Promise<Response>,
) {
  const fn = vi.fn(async (url: unknown) => (isHealth(url) ? health() : chat()));
  vi.stubGlobal("fetch", fn);
  return fn;
}
const noServer = (): Response => {
  throw new TypeError("Failed to fetch");
};
const chatCalls = (fn: ReturnType<typeof stubFetch>) =>
  fn.mock.calls.filter(([url]) => isChat(url));
const failure = async (p: Promise<unknown>): Promise<LlmTestError> => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(LlmTestError);
  return err as LlmTestError;
};

describe("runLlmTest", () => {
  const draft = { ...DRAFT, apiKey: "k" };
  beforeEach(() => {
    $serverReachable.set(null);
  });

  it("returns the streamed text and the direct route when no di server answers", async () => {
    stubFetch(noServer, () => sse([{ choices: [{ delta: { content: "ok" } }] }]));
    const seen: string[] = [];
    const res = await runLlmTest(draft, (t) => seen.push(t));
    expect(res).toEqual({ text: "ok", route: "direct", reasoningOnly: false });
    expect(seen).toEqual(["ok"]);
  });

  it("re-probes the server before routing: a persisted false must not force browser-direct", async () => {
    $serverReachable.set(false);
    const fn = stubFetch(HEALTH_OK, () => sse([{ choices: [{ delta: { content: "ok" } }] }]));
    const res = await runLlmTest(draft, () => undefined);
    expect(res.route).toBe("relay");
    expect(String(chatCalls(fn)[0]![0])).toContain("/v1/relay");
  });

  it("goes direct when a persisted true turns out stale", async () => {
    $serverReachable.set(true);
    const fn = stubFetch(noServer, () => sse([{ choices: [{ delta: { content: "ok" } }] }]));
    const res = await runLlmTest(draft, () => undefined);
    expect(res.route).toBe("direct");
    expect(String(chatCalls(fn)[0]![0])).toBe("https://api.example.com/v1/chat/completions");
  });

  it("blocks with a precise reason when fields are missing, without any call", async () => {
    const fn = stubFetch(HEALTH_OK, () => sse([]));
    expect(
      (await failure(runLlmTest({ ...draft, baseUrl: "" }, () => undefined))).cause,
    ).toMatchObject({ code: "llm.missingBaseUrl" });
    expect(
      (await failure(runLlmTest({ ...draft, baseUrl: "nope" }, () => undefined))).cause,
    ).toMatchObject({ code: "llm.invalidBaseUrl" });
    const err = await failure(runLlmTest({ ...draft, model: " " }, () => undefined));
    expect(err.cause).toMatchObject({ code: "llm.missingModel" });
    expect(err.route).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it("does not require an api key (keyless gateways)", async () => {
    stubFetch(noServer, () => sse([{ choices: [{ delta: { content: "ok" } }] }]));
    const res = await runLlmTest({ ...DRAFT, apiKey: "" }, () => undefined);
    expect(res.text).toBe("ok");
  });

  it("maps a failed browser-direct fetch to a CORS/network reason with the route", async () => {
    stubFetch(noServer, () => {
      throw new TypeError("Failed to fetch");
    });
    const err = await failure(runLlmTest(draft, () => undefined));
    expect(err.route).toBe("direct");
    expect(err.cause).toMatchObject({ code: "llm.network.direct" });
  });

  it("maps a failed relay fetch to a relay reason", async () => {
    stubFetch(HEALTH_OK, () => {
      throw new TypeError("Failed to fetch");
    });
    const err = await failure(runLlmTest(draft, () => undefined));
    expect(err.route).toBe("relay");
    expect(err.cause).toMatchObject({ code: "llm.network.relay" });
  });

  it("surfaces http errors with the upstream message and the route", async () => {
    stubFetch(noServer, () =>
      json(JSON.stringify({ error: { message: "No auth credentials found" } }), 401),
    );
    const err = await failure(runLlmTest(draft, () => undefined));
    expect(err.route).toBe("direct");
    expect(err.cause).toMatchObject({
      code: "llm.chat",
      params: { status: 401, detail: "No auth credentials found" },
    });
  });

  it("surfaces an html error page body", async () => {
    stubFetch(noServer, () => html(404));
    const err = await failure(runLlmTest(draft, () => undefined));
    expect(err.cause).toMatchObject({ code: "llm.chat", params: { status: 404 } });
  });

  it("surfaces in-band sse errors", async () => {
    stubFetch(noServer, () => sse([{ error: { message: "quota exceeded" } }]));
    const err = await failure(runLlmTest(draft, () => undefined));
    expect(err.cause).toMatchObject({ code: "llm.chat", params: { detail: "quota exceeded" } });
  });

  it("treats a reasoning-only stream as a working endpoint", async () => {
    stubFetch(noServer, () =>
      sse([
        { choices: [{ delta: { reasoning_content: "thinking" } }] },
        { choices: [{ delta: { reasoning: " more" } }] },
      ]),
    );
    const res = await runLlmTest(draft, () => undefined);
    expect(res).toEqual({ text: "", route: "direct", reasoningOnly: true });
  });

  it("reports a stream with neither text nor reasoning as llm.empty, not 'fields invalid'", async () => {
    stubFetch(noServer, () => sse([{ choices: [{ delta: {} }] }]));
    const err = await failure(runLlmTest(draft, () => undefined));
    expect(err.cause).toMatchObject({ code: "llm.empty" });
  });

  it("times out a hung stream with a coded reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        if (isHealth(url)) return noServer();
        return await new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        });
      }),
    );
    const err = await failure(runLlmTest(draft, () => undefined, { timeoutMs: 30 }));
    expect(err.cause).toMatchObject({ code: "llm.testTimeout" });
  });

  it("honors the anthropic flavor: native /v1/messages, x-api-key, never the relay", async () => {
    const fn = stubFetch(HEALTH_OK, () =>
      json(JSON.stringify({ content: [{ type: "text", text: "ok" }] })),
    );
    const res = await runLlmTest(
      {
        baseUrl: "https://api.anthropic.com",
        apiKey: "sk-ant",
        model: "claude-x",
        flavor: "anthropic",
      },
      () => undefined,
    );
    expect(res).toEqual({ text: "ok", route: "direct", reasoningOnly: false });
    const [url, init] = chatCalls(fn)[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant");
    expect(headers["anthropic-version"]).toBeTruthy();
    expect(JSON.parse(String(init.body)).max_tokens).toBeGreaterThanOrEqual(16);
  });

  it("anthropic: thinking-only content is a success, http errors keep their detail", async () => {
    const a = {
      baseUrl: "https://api.anthropic.com",
      apiKey: "k",
      model: "m",
      flavor: "anthropic" as const,
    };
    stubFetch(noServer, () =>
      json(JSON.stringify({ content: [{ type: "thinking", thinking: "..." }] })),
    );
    expect((await runLlmTest(a, () => undefined)).reasoningOnly).toBe(true);
    stubFetch(noServer, () => json(JSON.stringify({ error: { message: "bad key" } }), 401));
    const err = await failure(runLlmTest(a, () => undefined));
    expect(err.cause).toMatchObject({
      code: "llm.chat",
      params: { status: 401, detail: "bad key" },
    });
  });
});

describe("probeModels routing", () => {
  it("probes the server first when it has not settled, then relays", async () => {
    $serverReachable.set(null);
    const fn = vi.fn(async (url: unknown) => (isHealth(url) ? HEALTH_OK() : json(LIST)));
    vi.stubGlobal("fetch", fn);
    await probeModels({ ...DRAFT, apiKey: "k" });
    expect(String(fn.mock.calls.at(-1)![0])).toContain("/v1/relay");
  });

  it("anthropic flavor lists /v1/models with x-api-key, direct", async () => {
    $serverReachable.set(true);
    const fn = vi.fn(async () => json(LIST));
    vi.stubGlobal("fetch", fn);
    await probeModels({
      baseUrl: "https://api.anthropic.com",
      apiKey: "k",
      model: "",
      flavor: "anthropic",
    });
    const [url, init] = fn.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/models");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("k");
  });
});
