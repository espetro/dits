import { describe, expect, it, vi } from "vitest";
import { BrowserVoiceDriver, type RecognitionLike } from "./browser-driver";
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

/**
 * Speech recognition stub whose results can be emitted from tests.
 */
function fakeRecognitionCtor(): {
  ctor: new () => any;
  emit: (transcript: string) => void;
} {
  const listeners: { onresult?: (ev: any) => void } = {};
  class Rec implements RecognitionLike {
    continuous = false;
    interimResults = false;
    lang = "";
    onresult: ((ev: any) => void) | null = null;
    onerror: ((ev: any) => void) | null = null;
    onend: (() => void) | null = null;
    start() {
      const cb = this.onresult;
      if (cb) listeners.onresult = cb;
    }
    stop() {}
  }
  return {
    ctor: Rec as unknown as new () => any,
    emit: (transcript: string) =>
      listeners.onresult?.({
        resultIndex: 0,
        results: [{ isFinal: true, 0: { transcript } }],
      }),
  };
}

describe("BrowserVoiceDriver kickoff on silence", () => {
  function setupDriver() {
    const rec = fakeRecognitionCtor();
    const driver = new BrowserVoiceDriver("s1", {
      player: createPcmPlayer({ createContext: () => fakeCtx() }),
      recognitionCtor: rec.ctor,
    });
    const respond = vi.fn(async () => "hello, let's begin");
    driver.onError = vi.fn();
    driver.useClientAgent(
      { llm: LLM },
      {
        update_question: async () => "ok",
        read_editor: async () => "",
        read_whiteboard: async () => "",
      },
      () => ({ mode: "interview" }),
    );
    const agent = (driver as any).agent as { respond: (...args: any[]) => Promise<string> };
    agent.respond = respond as unknown as (...args: any[]) => Promise<string>;
    return { driver, respond, emit: rec.emit };
  }

  it("auto-fires the opening agent turn after the silence window", async () => {
    vi.useFakeTimers();
    try {
      const { driver, respond } = setupDriver();
      await driver.start();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(respond).toHaveBeenCalledTimes(1);
      const kickoffText = (respond.mock.calls as unknown[][])[0]![0] as string;
      expect(kickoffText).toMatch(/candidate has joined/);
      expect(kickoffText).toMatch(/ask your first question/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not kick off when the user speaks within the window", async () => {
    vi.useFakeTimers();
    try {
      const { driver, respond, emit } = setupDriver();
      await driver.start();
      emit("hello");
      await vi.advanceTimersByTimeAsync(10_000);
      expect(respond).toHaveBeenCalledTimes(1);
      expect((respond.mock.calls as unknown[][])[0]![0]).toBe("hello");
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels the kickoff on stop() and fires at most once", async () => {
    vi.useFakeTimers();
    try {
      const { driver, respond } = setupDriver();
      await driver.start();
      await driver.stop();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(respond).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
