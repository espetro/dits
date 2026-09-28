/**
 * sherpa-onnx streaming zipformer (int8, ctc) worker api.
 *
 * sherpa ships no browser esm build: the emscripten glue + asr api are
 * classic scripts whose top-level vars must land on the worker global
 * scope, so they load via the injected `loadScripts` (importScripts on a
 * classic worker) and expose `Module`/`createOnlineRecognizer` there.
 * The asset urls (glue/asr/wasm) are resolved on the main thread via ?url
 * and arrive in the init args; the 15MB wasm binary resolves via
 * locateFile, and the model + tokens bytes land in MEMFS.
 */

/** vite-emitted ?url asset urls, resolved on the main thread. */
export interface SttAssets {
  /** emscripten glue (classic script, attaches `Module`) */
  glueUrl: string;
  /** sherpa asr api (classic script, attaches `createOnlineRecognizer`) */
  asrUrl: string;
  /** wasm binary; resolved via locateFile */
  wasmUrl: string;
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
interface SherpaModule {
  FS: SherpaFs;
}
interface SherpaFactoryArg {
  locateFile?: (path: string, dir: string) => string;
  wasmBinary?: ArrayBuffer;
}
interface SherpaGlobalScope {
  Module: (arg: SherpaFactoryArg) => Promise<SherpaModule>;
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
      // classic scripts: top-level var/function land on the worker global scope
      deps.loadScripts([args.assets.glueUrl, args.assets.asrUrl]);
      const mod = await g.Module({
        locateFile: (path) => (path.endsWith(".wasm") ? args.assets.wasmUrl : path),
      });
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
