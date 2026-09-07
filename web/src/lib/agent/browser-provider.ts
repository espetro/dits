import type {
  LanguageModelV3,
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import { type BrowserLlmSection, type LlmSection, type RemoteLlmSection } from "@di/shared";
import { createOpenAiCompatibleModel } from "./openai-compatible-provider";

/**
 * In-browser LLM provider seam. `createLlmModel` picks the right
 * LanguageModel implementation for a profile's llm section: remote endpoints
 * keep the OpenAI-compatible fetch provider; browser sections get the
 * in-browser engines (Chrome Gemini Nano via the Prompt API, or
 * transformers.js over WebGPU). All engine packages are lazy imports so the
 * base bundle stays free of them.
 *
 * Both @browser-ai engines are LanguageModelV4 implementations; ai v7
 * accepts v2/v3/v4 models transparently, so they flow through streamText /
 * generateObject exactly like the remote provider.
 */

type AnyLanguageModel = LanguageModelV4 | LanguageModelV3;

export interface BrowserModelHandles {
  model: AnyLanguageModel;
  /** Preload / download the underlying engine weights with progress 0..1. */
  load(onProgress?: (fraction: number) => void): Promise<void>;
  /** Cheap probe used for status dots and the Test button. */
  status(): Promise<BrowserModelStatus>;
}

export interface BrowserModelStatus {
  /** "installed" = weights on disk; "available" = loaded and ready. */
  state: "unsupported" | "downloadable" | "installed" | "available";
  detail?: string;
}

/** Lazily created engine singletons (kept across calls). */
let geminiModel: AnyLanguageModel | null = null;
let transformersModel: AnyLanguageModel | null = null;
let transformersModelId: string | null = null;
let transformersModelWasm = false;

export const DEFAULT_TRANSFORMERS_MODEL_ID = "onnx-community/Qwen3-0.6B-ONNX";

/** Curated transformers.js catalog shown in the settings model manager. */
export interface CatalogModel {
  id: string;
  label: string;
  /** Rough on-disk size in MB for the q4 build. */
  sizeMb: number;
  ctx: number;
}

export const TRANSFORMERS_CATALOG: CatalogModel[] = [
  {
    id: DEFAULT_TRANSFORMERS_MODEL_ID,
    label: "Qwen3 0.6B (q4f16)",
    sizeMb: 450,
    ctx: 40960,
  },
  {
    id: "HuggingFaceTB/SmolLM2-360M-Instruct.ONNX",
    label: "SmolLM2 360M (q4)",
    sizeMb: 388,
    ctx: 8192,
  },
];

export function isRemoteLlm(section: LlmSection | undefined): section is RemoteLlmSection {
  return section !== undefined && section.mode === "remote";
}

export function isBrowserLlm(section: LlmSection | undefined): section is BrowserLlmSection {
  return section !== undefined && section.mode === "browser";
}

function geminiNanoHandles(): BrowserModelHandles | null {
  if (typeof window === "undefined" || !("LanguageModel" in globalThis)) {
    return null;
  }
  const ensure = async (): Promise<AnyLanguageModel> => {
    if (geminiModel) return geminiModel;
    const { browserAI } = await import("@browser-ai/core");
    geminiModel = browserAI.chat("text");
    return geminiModel;
  };
  return {
    get model() {
      if (!geminiModel) throw new Error("browser llm not loaded yet");
      return geminiModel;
    },
    async load(onProgress) {
      await ensure();
      const core = await import("@browser-ai/core");
      const probe = core.browserAI.chat("text") as unknown as {
        createSessionWithProgress?: (cb: (fraction: number) => void) => Promise<void>;
      };
      await probe.createSessionWithProgress?.((fraction: number) => onProgress?.(fraction));
    },
    async status(): Promise<BrowserModelStatus> {
      try {
        const lm = (
          globalThis as unknown as {
            LanguageModel: { availability(): Promise<string> };
          }
        ).LanguageModel;
        const availability = await lm.availability();
        if (availability === "unavailable") {
          return { state: "unsupported", detail: availability };
        }
        if (availability === "downloadable") return { state: "downloadable" };
        return { state: "installed", detail: availability };
      } catch {
        return { state: "unsupported" };
      }
    },
  };
}

/** Forced wasm/q4 override so the retry path rebuilds off webgpu. */
interface WasmOverride {
  device: "wasm";
  dtype: "q4";
}

const WASM_OVERRIDE: WasmOverride = { device: "wasm", dtype: "q4" };

/**
 * Normalize a transformers.js initProgressCallback event into a 0..1
 * fraction. Events are objects ({status, loaded, total, ...}); numeric
 * progress (Chrome built-in AI) passes through. Returns null for events
 * with no usable progress info.
 */
function normalizeProgressEvent(progress: unknown): number | null {
  if (typeof progress === "number") return progress;
  if (progress && typeof progress === "object") {
    const e = progress as { status?: string; loaded?: number; total?: number };
    if (e.status === "progress" && typeof e.total === "number" && e.total > 0) {
      return Math.min(1, (e.loaded ?? 0) / e.total);
    }
  }
  return null;
}

function lowMemoryDevice(): boolean {
  const memory = (navigator as { deviceMemory?: number }).deviceMemory;
  return memory !== undefined && memory <= 4;
}

function transformersHandles(requestedId?: string): BrowserModelHandles | null {
  const modelId = requestedId ?? DEFAULT_TRANSFORMERS_MODEL_ID;
  const ensure = async (
    onProgress?: (fraction: number) => void,
    override?: WasmOverride,
  ): Promise<AnyLanguageModel> => {
    if (
      transformersModel &&
      transformersModelId === modelId &&
      (!override || transformersModelWasm)
    ) {
      return transformersModel;
    }
    const { TransformersJSLanguageModel } = await import("@browser-ai/transformers-js");
    const wasm = override !== undefined || lowMemoryDevice();
    const created = new TransformersJSLanguageModel(
      modelId,
      wasm
        ? {
            ...WASM_OVERRIDE,
            initProgressCallback: (progress: unknown) => {
              const fraction = normalizeProgressEvent(progress);
              if (fraction !== null) onProgress?.(fraction);
            },
          }
        : {
            device: "auto",
            dtype: "q4f16",
            initProgressCallback: (progress: unknown) => {
              const fraction = normalizeProgressEvent(progress);
              if (fraction !== null) onProgress?.(fraction);
            },
          },
    );
    transformersModel = created;
    transformersModelId = modelId;
    transformersModelWasm = wasm;
    return created;
  };
  return {
    get model() {
      if (!transformersModel || transformersModelId !== modelId) {
        throw new Error("browser llm not loaded yet");
      }
      return transformersModel;
    },
    async load(onProgress) {
      const session = async (): Promise<void> => {
        const m = (await ensure(onProgress)) as {
          createSessionWithProgress?: (cb: (fraction: number) => void) => Promise<void>;
        };
        await m.createSessionWithProgress?.((fraction: number) => onProgress?.(fraction));
      };
      try {
        await session();
      } catch (err) {
        if (!(err instanceof Error) || !/webgpu|popErrorScope|validation/i.test(err.message)) {
          throw err;
        }
        transformersModel = null;
        transformersModelId = null;
        transformersModelWasm = false;
        try {
          await ensure(onProgress, WASM_OVERRIDE);
          await session();
        } catch {
          throw err;
        }
      }
    },
    async status(): Promise<BrowserModelStatus> {
      if (typeof navigator === "undefined" || !("gpu" in navigator)) {
        return { state: "unsupported", detail: "no webgpu" };
      }
      const installed = await transformersModelInstalled(modelId);
      const loaded = transformersModel !== null && transformersModelId === modelId;
      return {
        state: loaded ? "available" : installed ? "installed" : "downloadable",
      };
    },
  };
}

/**
 * transformers.js caches weights in the Cache API under the model's remote
 * URL; probe it directly so "installed" survives page reloads.
 */
export async function transformersModelInstalled(modelId: string): Promise<boolean> {
  if (typeof caches === "undefined") return false;
  try {
    const cache = await caches.open("transformers-cache");
    const keys = await cache.keys();
    return keys.some((req) => req.url.includes(modelId));
  } catch {
    return false;
  }
}

/** Delete cached weights for one model (Cache API purge by URL match). */
export async function deleteTransformersModel(modelId: string): Promise<void> {
  if (typeof caches === "undefined") return;
  const cache = await caches.open("transformers-cache");
  const keys = await cache.keys();
  await Promise.all(
    keys.filter((req) => req.url.includes(modelId)).map((req) => cache.delete(req)),
  );
  if (transformersModelId === modelId) {
    transformersModel = null;
    transformersModelId = null;
    transformersModelWasm = false;
  }
}

/** Purge every cached transformers.js model. */
export async function deleteAllTransformersModels(): Promise<void> {
  if (typeof caches === "undefined") return;
  await caches.delete("transformers-cache");
  transformersModel = null;
  transformersModelId = null;
  transformersModelWasm = false;
}

/**
 * One model for the current llm section. Returns null when the section asks
 * for an in-browser engine the current environment cannot serve (no Prompt
 * API / no WebGPU); callers surface that as a config error, not a crash.
 */
export function createLlmModel(
  section: LlmSection,
  opts: { fetchImpl?: typeof fetch } = {},
): { model: AnyLanguageModel; browser?: BrowserModelHandles } | null {
  if (isRemoteLlm(section)) {
    const remote = createOpenAiCompatibleModel(section, {
      fetchImpl: opts.fetchImpl,
    });
    return { model: remote as unknown as AnyLanguageModel };
  }
  const handles =
    section.engine === "gemini-nano" ? geminiNanoHandles() : transformersHandles(section.modelId);
  if (!handles) return null;
  // lazy: reading .model before load() would throw inside the getter
  return {
    get model() {
      return handles.model;
    },
    browser: handles,
  };
}

/**
 * Fallback engine preference for browser LLM sections: transformers.js
 * models are downloadable and deterministic (same weights everywhere), so
 * they are the primary pass; Chrome's Gemini Nano is the lower-priority
 * second pass when the transformers model is not installed yet (its
 * download is managed by Chrome and can be unavailable across platforms).
 */
export const BROWSER_LLM_FALLBACK: BrowserLlmSection = {
  mode: "browser",
  engine: "gemini-nano",
};

/**
 * Two-pass engine resolution for browser LLM sections: the configured
 * transformers.js model is the primary pass, but when it has never been
 * downloaded (nothing in the Cache API) the session falls back to Chrome's
 * Gemini Nano so a fresh browser can still run an interview immediately
 * instead of forcing a multi-hundred-MB download first. Remote sections and
 * already-downloaded transformers models resolve exactly like createLlmModel.
 */
export async function resolveBrowserLlm(
  section: LlmSection,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<{ model: AnyLanguageModel; browser?: BrowserModelHandles } | null> {
  if (!isBrowserLlm(section) || section.engine !== "transformers") {
    return createLlmModel(section, opts);
  }
  const modelId = section.modelId ?? DEFAULT_TRANSFORMERS_MODEL_ID;
  if (await transformersModelInstalled(modelId)) {
    return createLlmModel(section, opts);
  }
  const fallback = createLlmModel(BROWSER_LLM_FALLBACK, opts);
  if (fallback) return fallback;
  // No Prompt API either: keep the transformers model so load() surfaces
  // the download (and its progress) rather than a dead end.
  return createLlmModel(section, opts);
}

/** Ask a loaded model for a tiny answer; used by the settings Test button. */
export async function smokeTestModel(
  section: BrowserLlmSection,
  opts: { onProgress?: (fraction: number) => void; timeoutMs?: number } = {},
): Promise<void> {
  const handles =
    section.engine === "gemini-nano" ? geminiNanoHandles() : transformersHandles(section.modelId);
  if (!handles) throw new Error("engine unsupported in this browser");
  const load = handles.load(opts.onProgress);
  const timeout = opts.timeoutMs
    ? new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(new Error(`model load timed out after ${Math.round(opts.timeoutMs! / 1000)}s`)),
          opts.timeoutMs,
        ),
      )
    : null;
  if (timeout) {
    await Promise.race([load, timeout]);
  } else {
    await load;
  }
  const { generateText } = await import("ai");
  await generateText({
    model: handles.model,
    prompt: "Reply with the single word: ready.",
    maxOutputTokens: 8,
  });
}

export type { LanguageModelV4CallOptions, LanguageModelV4StreamPart };
