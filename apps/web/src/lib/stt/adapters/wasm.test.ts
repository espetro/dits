import { describe, expect, it } from "vitest";

import type { VoiceModelStorage } from "../../voice/models";
import { modelFileKey } from "../../voice/models";
import { fakeWorkerFor, memStorage } from "../../voice/wasm-test-support";
import type { SherpaSttApi } from "./sherpa/stt-api";
import { WasmStt, WasmSttNotReadyError } from "./wasm";

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
