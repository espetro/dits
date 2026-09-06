import { describe, expect, it, vi } from "vitest";
import { BrowserVoiceDriver } from "./browser-driver";
import { createPcmPlayer } from "./pcm-player";
import type { AudioContextLike } from "./pcm-player";

const LLM = {
  baseUrl: "http://t.local/v1",
  apiKey: "sk-x",
  model: "test-model",
} as const;

function fakeCtx(): AudioContextLike {
  const ctx: AudioContextLike = {
    sampleRate: 24_000,
    currentTime: 0,
    destination: {},
    createBuffer: (_c, length, rate) => ({
      duration: length / rate,
      getChannelData: () => new Float32Array(length),
    }),
    createBufferSource: () => {
      const node = {
        buffer: null as never,
        onended: null as never,
        connect: () => node,
        start: () => undefined,
        stop: () => undefined,
        disconnect: () => undefined,
      };
      return node;
    },
    close: async () => undefined,
  };
  return ctx;
}

/**
 * fetch mock that never resolves, only rejects with an AbortError once its
 * signal is aborted: mimics an in-flight LLM call interrupted by barge-in.
 */
function hangingFetch(): typeof fetch {
  return ((_url: unknown, init?: { signal?: AbortSignal }) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("This operation was aborted", "AbortError")),
      );
    })) as unknown as typeof fetch;
}

describe("BrowserVoiceDriver barge-in", () => {
  it("does not report an error when the agent turn is aborted mid-flight", async () => {
    const driver = new BrowserVoiceDriver("s1", {
      player: createPcmPlayer({ createContext: () => fakeCtx() }),
    });
    const onError = vi.fn();
    driver.onError = onError;
    driver.useClientAgent(
      { llm: LLM },
      {
        update_question: async () => "ok",
        read_editor: async () => "",
        read_whiteboard: async () => "",
      },
      () => ({ mode: "interview" }),
      hangingFetch(),
    );

    driver.sendText("tell me about caching");
    // let the turn start and hit the hanging fetch
    await new Promise((r) => setTimeout(r, 20));
    driver.interrupt();
    // flush microtasks so any abort rejection propagates
    await new Promise((r) => setTimeout(r, 20));

    expect(onError).not.toHaveBeenCalled();
  });
});
