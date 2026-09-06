import { describe, expect, it, vi } from "vitest";
import { ClientAgent } from "./client-agent";
import { decodeWav, resamplePcm16, synthesizeSpeech } from "./tts";

const LLM = {
  mode: "remote" as const,
  baseUrl: "http://t.local/v1",
  apiKey: "sk-x",
  model: "m1",
};
const TTS = {
  baseUrl: "http://t.local/v1",
  apiKey: "sk-x",
  model: "tts-1",
  voice: "alloy",
};

function sse(chunks: unknown[]): Response {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
  });
}

const CTX = () => ({ mode: "interview" });

describe("ClientAgent.respond", () => {
  it("emits a tool call then final text through streamText", async () => {
    const calls: any[] = [];
    const executors = {
      update_question: vi.fn(async () => "ok"),
      read_editor: vi.fn(async () => "(editor is empty)"),
      read_whiteboard: vi.fn(async () => "empty whiteboard"),
    };
    const fetchMock = vi.fn().mockImplementation(async (_u: string, init: any) => {
      const body = JSON.parse(init.body);
      const sawToolResult = body.messages.some((m: any) => m.role === "tool");
      calls.push(body.messages.length);
      if (!sawToolResult) {
        return sse([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "c1",
                      function: { name: "read_editor", arguments: "{}" },
                    },
                  ],
                },
              },
            ],
          },
        ]);
      }
      return sse([
        { choices: [{ delta: { content: "Let me think. " } }] },
        { choices: [{ delta: { content: "Here is my question." } }] },
      ]);
    });

    const agent = new ClientAgent(LLM, executors, CTX, fetchMock as unknown as typeof fetch);
    const deltas: string[] = [];
    const full = await agent.respond("hello", {
      onText: (d) => deltas.push(d),
    });

    expect(full).toBe("Let me think. Here is my question.");
    expect(deltas.join("")).toBe(full);
    expect(executors.read_editor).toHaveBeenCalledTimes(1);
    expect(calls.length).toBe(2); // tool hop + final hop
    // history holds user + assistant final
    expect(agent.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("surfaces a provider stream error via onError instead of swallowing it", async () => {
    const executors = {
      update_question: vi.fn(async () => "ok"),
      read_editor: vi.fn(async () => ""),
      read_whiteboard: vi.fn(async () => ""),
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response("server exploded", { status: 500 }));

    const agent = new ClientAgent(LLM, executors, CTX, fetchMock as unknown as typeof fetch);
    const errors: unknown[] = [];
    const full = await agent.respond("hello", {
      onError: (err) => errors.push(err),
    });

    expect(full).toBe("");
    expect(errors.length).toBe(1);
    expect(String(errors[0])).toContain("500");
  });

  it("aborts mid-stream stop iteration", async () => {
    const executors = {
      update_question: vi.fn(async () => "ok"),
      read_editor: vi.fn(async () => ""),
      read_whiteboard: vi.fn(async () => ""),
    };
    const ctrl = new AbortController();
    const fetchMock = vi.fn().mockImplementation(async () => {
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          const enc = new TextEncoder();
          controller.enqueue(
            enc.encode(
              `data: ${JSON.stringify({ choices: [{ delta: { content: "first. " } }] })}\n\n`,
            ),
          );
          await new Promise((r) => setTimeout(r, 20));
          ctrl.abort();
          await new Promise((r) => setTimeout(r, 20));
          controller.enqueue(
            enc.encode(
              `data: ${JSON.stringify({ choices: [{ delta: { content: "second." } }] })}\n\n`,
            ),
          );
          controller.close();
        },
      });
      return new Response(body, {
        headers: { "content-type": "text/event-stream" },
      });
    });

    const agent = new ClientAgent(LLM, executors, CTX, fetchMock as unknown as typeof fetch);
    const deltas: string[] = [];
    await agent.respond("hello", {
      signal: ctrl.signal,
      onText: (d) => deltas.push(d),
    });
    // only text emitted before the abort may be observed; no throw
    expect(deltas.join("")).not.toContain("second.");
  });
});

function wavBytes(pcm: Int16Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(44 + pcm.byteLength);
  const view = new DataView(buf);
  const str = (off: number, s: string) =>
    [...s].forEach((c, i) => view.setUint8(off + i, c.charCodeAt(0)));
  str(0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, pcm.byteLength, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i]!, true);
  return new Uint8Array(buf);
}

describe("tts", () => {
  it("decodeWav parses pcm and rate", () => {
    const pcm = Int16Array.from([1, -2, 3]);
    const out = decodeWav(wavBytes(pcm, 44100));
    expect(out.sampleRate).toBe(44100);
    expect([...out.pcm]).toEqual([1, -2, 3]);
  });

  it("resamplePcm16 converts rate", () => {
    const pcm = Int16Array.from([0, 1000, 2000, 3000]);
    const out = resamplePcm16(pcm, 48000, 24000);
    expect(out.length).toBe(2);
    const back = resamplePcm16(out, 24000, 48000);
    expect(back.length).toBe(4);
  });

  it("synthesizeSpeech posts to /v1/audio/speech and returns 24k pcm bytes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(wavBytes(Int16Array.from([100, -100]), 44100)));
    const bytes = await synthesizeSpeech(
      TTS,
      "hi",
      undefined,
      fetchMock as unknown as typeof fetch,
    );
    const init = fetchMock.mock.calls[0]![1];
    expect(fetchMock.mock.calls[0]![0]).toBe("http://t.local/v1/audio/speech");
    expect(init.headers.authorization).toBe("Bearer sk-x");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      model: "tts-1",
      voice: "alloy",
      input: "hi",
      response_format: "wav",
    });
    // 44100 -> 24000 resample of 2 samples => 1 sample
    expect(bytes.byteLength).toBe(2);
  });

  it("synthesizeSpeech throws on error status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 401 }));
    await expect(
      synthesizeSpeech(TTS, "hi", undefined, fetchMock as unknown as typeof fetch),
    ).rejects.toThrow("401");
  });
});
