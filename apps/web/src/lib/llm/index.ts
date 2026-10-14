/**
 * llm slice public entry. Callers import only from here: the port, the
 * factory and the probe/test helpers. Adapters (openai-compatible fetch
 * provider, in-browser engines) stay private to the slice.
 */
import type { LlmSection } from "@di/shared";
import { createLlmModel, resolveBrowserLlm } from "./adapters/browser";
import type { BrowserModelHandles } from "./adapters/browser";
import { probeModels, runLlmTest } from "./probe";
import type { ProbeDraft } from "./probe";

export type { ProbeDraft } from "./probe";
export { probeModels, runLlmTest } from "./probe";
export {
  BROWSER_LLM_FALLBACK,
  DEFAULT_TRANSFORMERS_MODEL_ID,
  TRANSFORMERS_CATALOG,
  createLlmModel,
  deleteAllTransformersModels,
  deleteTransformersModel,
  isBrowserLlm,
  isRemoteLlm,
  resolveBrowserLlm,
  smokeTestModel,
  transformersModelInstalled,
} from "./adapters/browser";
export type { BrowserModelHandles, BrowserModelStatus, CatalogModel } from "./adapters/browser";
export { createOpenAiCompatibleModel } from "./adapters/openai-compatible";
export type { OpenAiCompatibleOptions } from "./adapters/openai-compatible";

/** What the rest of the app needs from an llm provider. */
export interface LlmPort {
  /** One model for a section; null when an in-browser engine is unavailable. */
  createModel: typeof createLlmModel;
  /** Two-pass browser engine resolution (installed transformers, else gemini nano). */
  resolveModel(
    section: LlmSection,
    opts?: { fetchImpl?: typeof fetch },
  ): Promise<{ model: BrowserModelHandles["model"]; browser?: BrowserModelHandles } | null>;
  /** Sorted model ids from the endpoint's /models list. */
  probeModels(draft: ProbeDraft): Promise<string[]>;
  /** One short real completion; resolves the full text. */
  runTest(draft: ProbeDraft, onText: (text: string) => void): Promise<string>;
}

export function createLlmPort(): LlmPort {
  return {
    createModel: createLlmModel,
    resolveModel: resolveBrowserLlm,
    probeModels,
    runTest: runLlmTest,
  };
}
