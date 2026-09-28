import { expose } from "kkrpc/streaming";
import { workerSelfTransport } from "kkrpc/worker";
import { describe, expect, it } from "vitest";

import type { VoiceModelStorage } from "./models";
import { modelFileKey } from "./models";
import type { KittenTtsApi } from "./kitten/kitten-api";
import type { SherpaSttApi } from "./sherpa/stt-api";
import { WasmStt, WasmSttNotReadyError, WasmTts, WasmTtsNotReadyError } from "./wasm-engines";
import type { WorkerLike } from "./wasm-engines";

function memStorage(): VoiceModelStorage & { map: Map<string, ArrayBuffer> } {
  const map = new Map<string, ArrayBuffer>();
  return {
    map,
    get: async (key) => map.get(key) ?? null,
    put: async (key, bytes) => void map.set(key, bytes),
    clear: async () => map.clear(),
  };
}

/**
 * Fake worker bound to a real kkrpc channel pair: the api is exposed over a
 * scope-like object, and the returned WorkerLike bridges both directions
 * through microtask message delivery. Engines under test exercise the same
 * wire protocol they use against a real Worker.
 */
function fakeWorkerFor(api: object): WorkerLike {
  type Listener = (ev: MessageEvent) => void;
  const mainHandlers = new Set<Listener>();
  const workerHandlers = new Set<Listener>();
  const deliver = (to: Set<Listener>, msg: unknown) =>
    queueMicrotask(() => to.forEach((fn) => fn({ data: msg } as MessageEvent)));
  const scope = {
    postMessage(msg: unknown) {
      deliver(mainHandlers, msg);
    },
    addEventListener(_type: "message", fn: Listener) {
      workerHandlers.add(fn);
    },
    removeEventListener(_type: "message", fn: Listener) {
      workerHandlers.delete(fn);
    },
  };
  expose(api, workerSelfTransport(scope));
  return {
    postMessage(msg: unknown) {
      deliver(workerHandlers, msg);
    },
    addEventListener(_type: "message", fn) {
      mainHandlers.add(fn);
    },
    removeEventListener(_type: "message", fn) {
      mainHandlers.delete(fn);
    },
    onerror: null,
    terminate: () => undefined,
  };
}

/** Fake kitten api: init can fail once, speak yields two pcm chunks (or hangs). */
function fakeTtsApi(
  behavior?: Partial<{
    failInit: boolean;
    failSpeak: boolean;
    silentSpeak: boolean;
    /** runs in the worker-side generator's finally (cancel or completion) */
    onSpeakSettle: () => void;
  }>,
): KittenTtsApi {
  return {
    init: async () => {
      if (behavior?.failInit) throw new Error("init boom");
    },
    speak() {
      return (async function* () {
        try {
          if (behavior?.failSpeak) throw new Error("speak boom");
          if (behavior?.silentSpeak) await new Promise(() => undefined);
          yield new Float32Array([0.5, -0.5]);
          yield new Float32Array([1, -1]);
        } finally {
          behavior?.onSpeakSettle?.();
        }
      })();
    },
    clear: async () => undefined,
  };
}

/** Drain a speak stream into an array (streaming contract tests). */
async function collect(stream: AsyncIterable<Float32Array>): Promise<Float32Array[]> {
  const chunks: Float32Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

function installTts(store: VoiceModelStorage) {
  const version = "kitten-tts-nano-0.1";
  return Promise.all([
    store.put(modelFileKey("tts", version, "tts/model.onnx"), new ArrayBuffer(8)),
    store.put(modelFileKey("tts", version, "tts/voices.npz"), new ArrayBuffer(4)),
  ]);
}

describe("WasmTts", () => {
  it("boots the worker with cached model bytes and streams speak chunks in order", async () => {
    const storage = memStorage();
    await installTts(storage);
    const tts = new WasmTts({ workerFactory: () => fakeWorkerFor(fakeTtsApi()), storage });

    const chunks = await collect(tts.speak("hello there"));
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.[0]).toBeCloseTo(0.5);
    expect(chunks[1]?.[0]).toBeCloseTo(1);
  });

  it("rejects speak when model bytes are not cached", async () => {
    const tts = new WasmTts({
      workerFactory: () => fakeWorkerFor(fakeTtsApi()),
      storage: memStorage(),
    });
    await expect(collect(tts.speak("hi"))).rejects.toBeInstanceOf(WasmTtsNotReadyError);
  });

  it("propagates worker init errors and allows a retry", async () => {
    const storage = memStorage();
    await installTts(storage);
    let fail = true;
    const tts = new WasmTts({
      workerFactory: () => fakeWorkerFor(fakeTtsApi({ failInit: fail })),
      storage,
    });
    await expect(collect(tts.speak("hi"))).rejects.toThrow("init boom");
    fail = false;
    expect(await collect(tts.speak("hi"))).toHaveLength(2);
  });

  it("cancels the remote speak generator when the consumer abandons", async () => {
    const storage = memStorage();
    await installTts(storage);
    let settled = false;
    const tts = new WasmTts({
      workerFactory: () =>
        fakeWorkerFor(
          fakeTtsApi({
            onSpeakSettle: () => {
              settled = true;
            },
          }),
        ),
      storage,
    });
    const stream = tts.speak("hi")[Symbol.asyncIterator]();
    await stream.next();
    // consumer abandon (timeout/abort) -> return() must propagate through the
    // engine generator into the worker-side generator's finally
    await stream.return?.(undefined);
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(true);
  });

  it("rejects in-flight speaks on dispose", async () => {
    const storage = memStorage();
    await installTts(storage);
    // api that never resolves speaks
    const tts = new WasmTts({
      workerFactory: () => fakeWorkerFor(fakeTtsApi({ silentSpeak: true })),
      storage,
    });
    const pending = tts.speak("stuck")[Symbol.asyncIterator]().next();
    // let boot() finish so the speak iterator is registered
    await new Promise((r) => setTimeout(r, 0));
    tts.dispose();
    await expect(pending).rejects.toThrow();
  });
});

/** Fake sherpa api: feed emits a partial, flush emits a final. */
function fakeSttApi(): SherpaSttApi {
  let onPartial: (text: string) => void = () => undefined;
  let onFinal: (text: string) => void = () => undefined;
  return {
    init: async (_args, partialCb, finalCb) => {
      onPartial = partialCb;
      onFinal = finalCb;
    },
    feed: async () => {
      onPartial("par");
    },
    flush: async () => {
      onFinal("hello world");
    },
  };
}

function installStt(store: VoiceModelStorage) {
  const version = "zipformer2-ctc-en-small-2024-03-18";
  return Promise.all([
    store.put(modelFileKey("stt", version, "stt/model.onnx"), new ArrayBuffer(8)),
    store.put(modelFileKey("stt", version, "stt/tokens.txt"), new ArrayBuffer(4)),
  ]);
}

describe("WasmStt", () => {
  it("prepare rejects when the stt model is not cached", async () => {
    const stt = new WasmStt({ storage: memStorage() });
    await expect(stt.prepare()).rejects.toBeInstanceOf(WasmSttNotReadyError);
  });

  it("buffers pre-boot frames, then relays partial/final to callbacks", async () => {
    const storage = memStorage();
    await installStt(storage);
    const stt = new WasmStt({ workerFactory: () => fakeWorkerFor(fakeSttApi()), storage });
    const seen: string[] = [];
    const started = stt.start({
      onInterim: (t) => seen.push(`i:${t}`),
      onFinal: (t) => seen.push(`f:${t}`),
      onSpeechStart: () => seen.push("start"),
    });
    // a frame arriving while the worker boots must not be lost
    stt.feed(new Float32Array(4));
    await started;
    stt.feed(new Float32Array(4));
    await stt.flush();
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toContain("f:hello world");
    expect(seen).toContain("i:par");
  });

  it("stop terminates the worker and drops later finals", async () => {
    const storage = memStorage();
    await installStt(storage);
    const stt = new WasmStt({ workerFactory: () => fakeWorkerFor(fakeSttApi()), storage });
    await stt.start({ onInterim: () => {}, onFinal: () => {}, onSpeechStart: () => {} });
    await stt.stop();
    stt.feed(new Float32Array(4)); // must not throw
    await expect(stt.prepare()).resolves.toBeUndefined();
  });
});
