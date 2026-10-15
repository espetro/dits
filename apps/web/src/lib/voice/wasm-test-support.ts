import { expose } from "kkrpc/streaming";
import { workerSelfTransport } from "kkrpc/worker";

import type { VoiceModelStorage } from "./models";
import type { WorkerLike } from "./wasm-shared";

export function memStorage(): VoiceModelStorage & { map: Map<string, ArrayBuffer> } {
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
export function fakeWorkerFor(api: object): WorkerLike {
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
