import { beforeEach, describe, expect, it, vi } from "vitest";
import { turnstileTokenFor } from "../turnstile";
import { DiError } from "../errors";
import { probeModels, runLlmTest } from "./probe";

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

describe("runLlmTest", () => {
  const sse = (chunks: unknown[]): Response =>
    new Response(
      chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n",
      {
        headers: { "content-type": "text/event-stream" },
      },
    );

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("returns the streamed text", async () => {
    vi.mocked(fetch).mockResolvedValue(sse([{ choices: [{ delta: { content: "ok" } }] }]));
    const seen: string[] = [];
    const text = await runLlmTest({ ...DRAFT, apiKey: "k" }, (t) => seen.push(t));
    expect(text).toBe("ok");
    expect(seen).toEqual(["ok"]);
  });

  it("surfaces http errors with the upstream message instead of an empty stream", async () => {
    vi.mocked(fetch).mockResolvedValue(
      json(JSON.stringify({ error: { message: "No auth credentials found" } }), 401),
    );
    await expect(runLlmTest({ ...DRAFT, apiKey: "k" }, () => undefined)).rejects.toMatchObject({
      code: "llm.chat",
      params: { status: 401, detail: "No auth credentials found" },
    });
  });

  it("surfaces an html error page body", async () => {
    vi.mocked(fetch).mockResolvedValue(html(404));
    await expect(runLlmTest({ ...DRAFT, apiKey: "k" }, () => undefined)).rejects.toMatchObject({
      code: "llm.chat",
      params: { status: 404 },
    });
  });

  it("surfaces in-band sse errors", async () => {
    vi.mocked(fetch).mockResolvedValue(sse([{ error: { message: "quota exceeded" } }]));
    await expect(runLlmTest({ ...DRAFT, apiKey: "k" }, () => undefined)).rejects.toMatchObject({
      code: "llm.chat",
      params: { detail: "quota exceeded" },
    });
  });
});
