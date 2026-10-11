/**
 * sherpa-onnx streaming zipformer (int8, ctc) worker api.
 *
 * the npm package only ships the nodejs glue, so the runtime is the
 * vendored browser build (public/sherpa/, see its README): classic
 * scripts whose top-level vars land on the worker global scope, loaded
 * via the injected `loadScripts` (importScripts on a classic worker).
 * the glue self-initializes at script load: `Module` must already sit on
 * the global scope with locateFile (routes the 13MB .wasm and the stub
 * .data fetch) plus the ready/abort hooks — there is no factory call.
 * the model + tokens bytes land in MEMFS via FS.writeFile.
 *
 * feed/flush session semantics are shared with the server-side builtin
 * engine via @di/voice-engines' createSherpaSession.
 */
import { createSherpaSession } from "@di/voice-engines/sherpa-session";
import type { SherpaRecognizer, SherpaSession } from "@di/voice-engines/sherpa-session";

/** urls for the vendored browser build under public/sherpa/. */
export interface SttAssets {
  /** emscripten glue (classic script, attaches `Module`) */
  glueUrl: string;
  /** sherpa asr api (classic script, attaches `createOnlineRecognizer`) */
  asrUrl: string;
  /** wasm binary; resolved via locateFile */
  wasmUrl: string;
  /** file-packager stub blob; fetched unconditionally by the glue at init */
  dataUrl: string;
}

export interface SttInitArgs {
  model: ArrayBuffer;
  tokens: ArrayBuffer;
  assets: SttAssets;
}

export interface SherpaSttApi {
  /**
   * Loads the sherpa runtime + model; rejects with the init failure. The
   * partial/final callbacks are registered once here and fire until the
   * next init.
   */
  init(
    args: SttInitArgs,
    onPartial: (text: string) => void,
    onFinal: (text: string) => void,
  ): Promise<void>;
  /** 16kHz mono Float32 frames from mic capture. */
  feed(samples: Float32Array): Promise<void>;
  /** Utterance boundary (silero vad speech end): drains the stream and emits onFinal. */
  flush(): Promise<void>;
}

/** seeded on the worker global scope BEFORE the glue loads. */
interface SherpaModuleSeed {
  locateFile?: (path: string, dir: string) => string;
  onRuntimeInitialized?: () => void;
  onAbort?: (what: unknown) => void;
}
/** the same object after the glue finishes init (populated in place). */
interface SherpaModule extends SherpaModuleSeed {
  /**
   * module-level export the glue itself uses for .data files — in this
   * flat classic build top-level `var FS` lands on worker globalThis, not
   * on Module, so there is no `Module.FS`.
   */
  FS_createDataFile(
    parent: string,
    name: string | null,
    data: Uint8Array,
    canRead: boolean,
    canWrite: boolean,
    canOwn: boolean,
  ): void;
}
interface SherpaGlobalScope {
  Module: SherpaModuleSeed | SherpaModule;
  createOnlineRecognizer(
    module: SherpaModule,
    config: {
      featConfig: { sampleRate: number; featureDim: number };
      modelConfig: {
        zipformer2Ctc: { model: string };
        tokens: string;
        numThreads: number;
        provider: string;
        debug: number;
      };
    },
  ): SherpaRecognizer;
}

export interface SherpaSttDeps {
  /** importScripts on the classic worker; tests inject a stub that populates globalThis */
  loadScripts(urls: string[]): void;
}

export function createSherpaSttApi(deps: SherpaSttDeps): SherpaSttApi {
  const g = globalThis as unknown as SherpaGlobalScope;

  let session: SherpaSession | null = null;

  return {
    async init(args, partialCb, finalCb) {
      // the glue self-initializes at script load, so Module is seeded on the
      // global scope FIRST: locateFile routes the .wasm + .data fetches, the
      // ready/abort hooks settle init — there is no factory call
      const initialized = new Promise<void>((resolve, reject) => {
        g.Module = {
          locateFile: (path) =>
            path.endsWith(".wasm")
              ? args.assets.wasmUrl
              : path.endsWith(".data")
                ? args.assets.dataUrl
                : path,
          onRuntimeInitialized: resolve,
          onAbort: (what) => reject(new Error(`sherpa wasm aborted: ${String(what)}`)),
        };
      });
      // classic scripts: top-level var/function land on the worker global scope
      deps.loadScripts([args.assets.glueUrl, args.assets.asrUrl]);
      await initialized;
      // init resolved => the glue populated its exports on the seeded Module
      const mod = g.Module as SherpaModule;
      mod.FS_createDataFile("/model.onnx", null, new Uint8Array(args.model), true, true, true);
      mod.FS_createDataFile("/tokens.txt", null, new Uint8Array(args.tokens), true, true, true);
      const recognizer = g.createOnlineRecognizer(mod, {
        featConfig: { sampleRate: 16000, featureDim: 80 },
        modelConfig: {
          zipformer2Ctc: { model: "model.onnx" },
          tokens: "tokens.txt",
          numThreads: 1,
          provider: "cpu",
          debug: 0,
        },
      });
      session = createSherpaSession(recognizer, recognizer.createStream(), {
        onPartial: partialCb,
        onFinal: finalCb,
      });
    },

    async feed(samples) {
      if (!session) throw new Error("stt worker not initialized");
      session.feed(samples);
    },

    async flush() {
      if (!session) throw new Error("stt worker not initialized");
      session.flush();
    },
  };
}
