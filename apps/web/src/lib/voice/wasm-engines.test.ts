import { describe, expect, it } from "vitest";
import type { VoiceModelStorage } from "./models";
import { modelFileKey } from "./models";
import type { KittenInMsg, KittenOutMsg } from "./kitten/kitten-worker";
import { WasmTts, WasmTtsNotReadyError, WasmStt, WasmSttNotReadyError } from "./wasm-engines";
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

/** Fake worker: replies ready on init, echoes a stub pcm on speak. */
function fakeWorker(
  behavior?: Partial<{ failInit: boolean; failSpeak: boolean; silentSpeak: boolean }>,
): WorkerLike & { sent: unknown[] } {
  const sent: unknown[] = [];
  let onmessage: WorkerLike["onmessage"] = null;
  const post = (msg: KittenOutMsg, transfer?: Transferable[]) => {
    void transfer;
    queueMicrotask(() => onmessage?.({ data: msg } as MessageEvent<unknown>));
  };
  return {
    sent,
    get onmessage() {
      return onmessage;
    },
    set onmessage(cb) {
      onmessage = cb;
    },
    onerror: null,
    postMessage(msg: unknown) {
      sent.push(msg);
      const m = msg as KittenInMsg;
      if (m.type === "init") {
        if (behavior?.failInit) return post({ type: "error", id: null, message: "init boom" });
        return post({ type: "ready" });
      }
      if (behavior?.failSpeak) return post({ type: "error", id: m.id, message: "speak boom" });
      if (behavior?.silentSpeak) return;
      post({ type: "pcm", id: m.id, pcm: new Float32Array([0.5, -0.5]) });
    },
    terminate: () => undefined,
  };
}

function installTts(store: VoiceModelStorage) {
  const version = "kitten-tts-nano-0.1";
  return Promise.all([
    store.put(modelFileKey("tts", version, "tts/model.onnx"), new ArrayBuffer(8)),
    store.put(modelFileKey("tts", version, "tts/voices.npz"), new ArrayBuffer(4)),
  ]);
}

describe("WasmTts", () => {
  it("boots the worker with cached model bytes and resolves speak pcm", async () => {
    const storage = memStorage();
    await installTts(storage);
    const worker = fakeWorker();
    const tts = new WasmTts({ workerFactory: () => worker, storage });

    const pcm = await tts.speak("hello there");
    expect(pcm).toBeInstanceOf(Float32Array);
    expect(pcm.length).toBe(2);
    expect(pcm[0]).toBeCloseTo(0.5);

    const init = worker.sent[0] as KittenInMsg;
    expect(init.type).toBe("init");
    const speak = worker.sent[1] as KittenInMsg;
    expect(speak.type).toBe("speak");
  });

  it("rejects speak when model bytes are not cached", async () => {
    const tts = new WasmTts({ workerFactory: () => fakeWorker(), storage: memStorage() });
    await expect(tts.speak("hi")).rejects.toBeInstanceOf(WasmTtsNotReadyError);
  });

  it("propagates worker init errors and allows a retry", async () => {
    const storage = memStorage();
    await installTts(storage);
    let fail = true;
    const tts = new WasmTts({
      workerFactory: () => fakeWorker({ failInit: fail }),
      storage,
    });
    await expect(tts.speak("hi")).rejects.toThrow("init boom");
    fail = false;
    await expect(tts.speak("hi")).resolves.toBeInstanceOf(Float32Array);
  });

  it("rejects in-flight speaks on dispose", async () => {
    const storage = memStorage();
    await installTts(storage);
    // worker that never answers speaks
    const worker = fakeWorker({ silentSpeak: true });
    const tts = new WasmTts({ workerFactory: () => worker, storage });
    const pending = tts.speak("stuck");
    // let boot() finish so the pending entry is registered
    await new Promise((r) => setTimeout(r, 0));
    tts.dispose();
    await expect(pending).rejects.toThrow("disposed");
  });
});

describe("WasmStt (stub, phase d)", () => {
  it("prepare rejects when the stt model is not cached", async () => {
    const stt = new WasmStt({ storage: memStorage() });
    await expect(stt.prepare()).rejects.toBeInstanceOf(WasmSttNotReadyError);
  });
});
