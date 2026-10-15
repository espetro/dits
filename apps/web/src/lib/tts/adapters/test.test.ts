import { describe, expect, it, vi } from "vitest";
import { DiError } from "../../errors";
import { testBrowserTts } from "./browser";
import { testServerTts } from "./server";

const json = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { "content-type": "application/json" } });

describe("testServerTts", () => {
  it("returns the clip and the server-measured ms", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(new Uint8Array(8), { headers: { "x-synth-ms": "123" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const out = await testServerTts("hi");
    expect(out.ms).toBe(123);
    expect(out.clip.size).toBe(8);
    expect(fetchMock.mock.calls[0]![0]).toMatch(/\/v1\/voice\/tts-test$/);
  });

  it("surfaces the server error detail and status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(JSON.stringify({ error: "model missing" }), 502)),
    );
    const err = await testServerTts("hi").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DiError);
    expect((err as DiError).code).toBe("tts.server");
    expect((err as DiError).params?.status).toBe(502);
    expect((err as DiError).message).toBe("model missing");
  });

  it("maps a network failure to status 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("down");
      }),
    );
    const err = (await testServerTts("hi").catch((e: unknown) => e)) as DiError;
    expect(err.params?.status).toBe(0);
  });
});

describe("testBrowserTts", () => {
  it("rejects when speechSynthesis is missing", async () => {
    vi.stubGlobal("speechSynthesis", undefined);
    await expect(testBrowserTts("hi")).rejects.toMatchObject({ code: "tts.builtin" });
  });

  it("rejects when no voices are installed instead of passing silently", async () => {
    vi.stubGlobal("speechSynthesis", { getVoices: () => [], speak: vi.fn(), cancel: vi.fn() });
    await expect(testBrowserTts("hi")).rejects.toMatchObject({ code: "tts.builtin" });
  });
});
