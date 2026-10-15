import { afterEach, describe, expect, it, vi } from "vitest";
import { DiError } from "../../errors";
import { testServerStt } from "./server";

afterEach(() => vi.unstubAllGlobals());

describe("testServerStt", () => {
  it("posts the wav to /v1/voice/stt-test and returns text with server ms", async () => {
    const fetchMock = vi.fn(async () => Response.json({ text: "hello", ms: 42 }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await testServerStt(new Uint8Array(8));
    expect(out).toEqual({ text: "hello", ms: 42 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/v1/voice/stt-test");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("audio/wav");
  });

  it("maps a missing model and upstream failures to coded errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "x", code: "stt_model_missing" }, { status: 409 })),
    );
    await expect(testServerStt(new Uint8Array(8))).rejects.toMatchObject({
      code: "stt.serverModelMissing",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "upstream 401", code: "stt_failed" }, { status: 502 }),
      ),
    );
    const err = await testServerStt(new Uint8Array(8)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DiError);
    expect((err as DiError).params).toEqual({ status: 502, detail: "upstream 401" });
  });
});
