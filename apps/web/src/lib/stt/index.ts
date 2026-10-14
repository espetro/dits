/**
 * stt slice public entry. Callers import only from here: the engine port,
 * the endpoint engine and the settings test helpers. Adapters (openai
 * transcriptions endpoint, Web Speech) stay private; the wasm engine still
 * lives in lib/voice until that moves.
 */
import type { ProviderEndpoint } from "@di/shared";
import { EndpointStt } from "./adapters/endpoint";
import type { SttEngine } from "./port";

export type { SttEngine, SttEngineCallbacks } from "./port";
export { EndpointStt } from "./adapters/endpoint";
export { hasBrowserStt, startLiveStt, testBrowserStt } from "./adapters/browser";
export { startEngineSttTest } from "./engine-test";
export { WasmStt } from "../voice/wasm-engines";

/** Build the cloud (BYO transcriptions endpoint) engine for a profile's stt section. */
export function createEndpointStt(endpoint: ProviderEndpoint): SttEngine {
  return new EndpointStt(endpoint);
}
