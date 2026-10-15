/**
 * stt slice public entry. Callers import only from here: the engine port,
 * the endpoint engine and the settings test helpers (engine and server-layer). Adapters (openai
 * transcriptions endpoint, Web Speech) stay private; the on-device wasm
 * engine (adapters/wasm.ts) is re-exported here.
 */
import type { ProviderEndpoint } from "@di/shared";
import { EndpointStt } from "./adapters/endpoint";
import type { SttEngine } from "./port";

export type { SttEngine, SttEngineCallbacks } from "./port";
export { EndpointStt } from "./adapters/endpoint";
export { hasBrowserStt, startLiveStt, testBrowserStt } from "./adapters/browser";
export { startEngineSttTest } from "./engine-test";
export { startServerSttTest } from "./server-test";
export { WasmStt, WasmSttNotReadyError } from "./adapters/wasm";

/** Build the cloud (BYO transcriptions endpoint) engine for a profile's stt section. */
export function createEndpointStt(endpoint: ProviderEndpoint): SttEngine {
  return new EndpointStt(endpoint);
}
