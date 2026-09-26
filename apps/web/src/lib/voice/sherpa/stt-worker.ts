/// <reference lib="webworker" />
/**
 * sherpa-onnx streaming zipformer (int8, ctc) in a dedicated worker.
 *
 * sherpa ships no browser esm build: the emscripten glue + asr api are
 * classic scripts, so they load via importScripts from vite-emitted asset
 * urls (?url) and attach `Module`/`createOnlineRecognizer` to the worker
 * global scope. The 15MB wasm binary resolves via locateFile -> emitted
 * asset url; model + tokens bytes come from the manifest cache over
 * postMessage and land in MEMFS.
 */
import sherpaWasmUrl from "sherpa-onnx/sherpa-onnx-wasm-nodejs.wasm?url";
import sherpaGlueUrl from "sherpa-onnx/sherpa-onnx-wasm-nodejs.js?url";
import sherpaAsrUrl from "sherpa-onnx/sherpa-onnx-asr.js?url";

export interface SttInitMsg {
  type: "init";
  model: ArrayBuffer;
  tokens: ArrayBuffer;
}
export interface SttFeedMsg {
  type: "feed";
  samples: Float32Array;
}
export interface SttFlushMsg {
  type: "flush";
}
export type SttInMsg = SttInitMsg | SttFeedMsg | SttFlushMsg;

export type SttOutMsg =
  | { type: "ready" }
  | { type: "partial"; text: string }
  | { type: "final"; text: string }
  | { type: "error"; message: string };

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
type SherpaFactory = (arg: {
  locateFile?: (path: string, dir: string) => string;
  wasmBinary?: ArrayBuffer;
}) => Promise<SherpaModule>;

interface SherpaGlobalScope {
  Module: SherpaFactory;
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

const g = globalThis as unknown as SherpaGlobalScope;

let recognizer: SherpaRecognizer | null = null;
let stream: SherpaStream | null = null;
let lastPartial = "";

function post(msg: SttOutMsg, transfer?: Transferable[]): void {
  (self as unknown as Worker).postMessage(msg, transfer ?? []);
}

async function init(msg: SttInitMsg): Promise<void> {
  // classic scripts: top-level var/function land on the worker global scope
  self.importScripts(sherpaGlueUrl, sherpaAsrUrl);
  const mod = await g.Module({
    locateFile: (path) => (path.endsWith(".wasm") ? sherpaWasmUrl : path),
  });
  mod.FS.writeFile("model.onnx", new Uint8Array(msg.model));
  mod.FS.writeFile("tokens.txt", new Uint8Array(msg.tokens));
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
}

/** Decode pending frames; post a partial only when the text actually moved. */
function decodeStep(): void {
  if (!recognizer || !stream) return;
  while (recognizer.isReady(stream)) recognizer.decode(stream);
  const text = recognizer.getResult(stream).text ?? "";
  if (text !== lastPartial) {
    lastPartial = text;
    if (text) post({ type: "partial", text });
  }
}

/** Utterance boundary (from the silero vad on the main thread, or sherpa's own endpoint). */
function finishUtterance(): void {
  if (!recognizer || !stream) return;
  decodeStep();
  const text = lastPartial;
  post({ type: "final", text });
  recognizer.reset(stream);
  lastPartial = "";
}

self.onmessage = (ev: MessageEvent<SttInMsg>) => {
  const msg = ev.data;
  void (async () => {
    if (msg.type === "init") {
      await init(msg);
      post({ type: "ready" });
      return;
    }
    if (!recognizer || !stream) throw new Error("stt worker not initialized");
    if (msg.type === "feed") {
      stream.acceptWaveform(16000, msg.samples);
      decodeStep();
      // sherpa's trailing-silence rules as a backstop for vad endpointing
      if (recognizer.isEndpoint(stream)) finishUtterance();
    } else {
      stream.inputFinished();
      finishUtterance();
    }
  })().catch((err: unknown) => {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  });
};
