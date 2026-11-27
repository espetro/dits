import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { $serverReachable } from "../../runtime";
import { synthesizeSpeech } from "./endpoint";

const TTS = { baseUrl: "https://api.example.com/v1", apiKey: "sk-x", model: "tts-1", voice: "v" };

function wav(): Response {
  const buf = new ArrayBuffer(46);
  const view = new DataView(buf);
  const str = (off: number, s: string) =>
    [...s].forEach((c, i) => view.setUint8(off + i, c.charCodeAt(0)));
  str(0, "RIFF");
  view.setUint32(4, 38, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true);
  view.setUint32(28, 48000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, 2, true);
  return new Response(buf);
}

describe("synthesizeSpeech default fetch", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => wav()),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    $serverReachable.set(null);
  });

  it("goes browser-direct when the relay is inactive", async () => {
    $serverReachable.set(false);
    await synthesizeSpeech(TTS, "hi");
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("https://api.example.com/v1/audio/speech");
  });

  it("reroutes through the di relay when the server is reachable", async () => {
    $serverReachable.set(true);
    await synthesizeSpeech(TTS, "hi");
    const [input, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(input).toBe(
      `/v1/relay?url=${encodeURIComponent("https://api.example.com/v1/audio/speech")}`,
    );
    expect((init!.headers as Record<string, string>).authorization).toBe("Bearer sk-x");
  });
});
