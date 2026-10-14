import { describe, expect, it } from "vitest";

import type { KittenTtsApi } from "@di/voice-engines/kitten";
import type { VoiceModelStorage } from "../../voice/models";
import { modelFileKey } from "../../voice/models";
import { fakeWorkerFor, memStorage } from "../../voice/wasm-test-support";
import { WasmTts, WasmTtsNotReadyError } from "./wasm";

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
