import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { $serverReachable } from "../../runtime";
import { EndpointStt } from "./endpoint";

const STT = { baseUrl: "https://api.example.com/v1", apiKey: "sk-x", model: "whisper-1" };

async function transcribe(): Promise<string[]> {
  const finals: string[] = [];
  const stt = new EndpointStt(STT);
  await stt.start({
    onFinal: (t) => finals.push(t),
    onInterim: () => undefined,
    onSpeechStart: () => undefined,
  });
  stt.feed(new Float32Array(160));
  await stt.flush();
  return finals;
}

describe("EndpointStt fetch seam", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ text: " hello " })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    $serverReachable.set(null);
  });

  it("goes browser-direct when the relay is inactive", async () => {
    $serverReachable.set(false);
    expect(await transcribe()).toEqual(["hello"]);
    const [input, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(input).toBe("https://api.example.com/v1/audio/transcriptions");
    expect((init!.headers as Record<string, string>).authorization).toBe("Bearer sk-x");
  });

  it("reroutes through the di relay when the server is reachable", async () => {
    $serverReachable.set(true);
    expect(await transcribe()).toEqual(["hello"]);
    const [input, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(input).toBe(
      `/v1/relay?url=${encodeURIComponent("https://api.example.com/v1/audio/transcriptions")}`,
    );
    expect((init!.headers as Record<string, string>).authorization).toBe("Bearer sk-x");
    expect(init!.body).toBeInstanceOf(FormData);
  });
});
