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
 */

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

interface SherpaFs {
  writeFile(path: string, data: Uint8Array): void;
}
interface SherpaStream {
  acceptWaveform(sampleRate: number, samples: Float32Array): void;
  inputFinished(): void;
}
interface SherpaRecognizer {
  createStream(): SherpaStream;
  isReady(stream: SherpaStream): boolean;
  decode(stream: SherpaStream): void;
  isEndpoint(stream: SherpaStream): boolean;
  reset(stream: SherpaStream): void;
  getResult(stream: SherpaStream): { text?: string };
}
/** seeded on the worker global scope BEFORE the glue loads. */
interface SherpaModuleSeed {
  locateFile?: (path: string, dir: string) => string;
  onRuntimeInitialized?: () => void;
  onAbort?: (what: unknown) => void;
}
/** the same object after the glue finishes init (FS is populated in place). */
interface SherpaModule extends SherpaModuleSeed {
  FS: SherpaFs;
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

  let recognizer: SherpaRecognizer | null = null;
  let stream: SherpaStream | null = null;
  let lastPartial = "";
  let onPartial: (text: string) => void = () => undefined;
  let onFinal: (text: string) => void = () => undefined;

  /** Decode pending frames; emit a partial only when the text actually moved. */
  function decodeStep(): void {
    if (!recognizer || !stream) return;
    while (recognizer.isReady(stream)) recognizer.decode(stream);
    const text = recognizer.getResult(stream).text ?? "";
    if (text !== lastPartial) {
      lastPartial = text;
      if (text) onPartial(text);
    }
  }

  /** Utterance boundary (from the silero vad on the main thread, or sherpa's own endpoint). */
  function finishUtterance(): void {
    if (!recognizer || !stream) return;
    decodeStep();
    const text = lastPartial;
    onFinal(text);
    recognizer.reset(stream);
    lastPartial = "";
  }

  return {
    async init(args, partialCb, finalCb) {
      onPartial = partialCb;
      onFinal = finalCb;
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
      // init resolved => the glue populated FS onto the seeded Module in place
      const mod = g.Module as SherpaModule;
      mod.FS.writeFile("model.onnx", new Uint8Array(args.model));
      mod.FS.writeFile("tokens.txt", new Uint8Array(args.tokens));
      recognizer = g.createOnlineRecognizer(mod, {
        featConfig: { sampleRate: 16000, featureDim: 80 },
        modelConfig: {
          zipformer2Ctc: { model: "model.onnx" },
          tokens: "tokens.txt",
          numThreads: 1,
          provider: "cpu",
          debug: 0,
        },
      });
      stream = recognizer.createStream();
      lastPartial = "";
    },

    async feed(samples) {
      if (!recognizer || !stream) throw new Error("stt worker not initialized");
      stream.acceptWaveform(16000, samples);
      decodeStep();
      // sherpa's trailing-silence rules as a backstop for vad endpointing
      if (recognizer.isEndpoint(stream)) finishUtterance();
    },

    async flush() {
      if (!recognizer || !stream) throw new Error("stt worker not initialized");
      stream.inputFinished();
      finishUtterance();
    },
  };
}
