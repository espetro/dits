/**
 * Server-side sherpa-onnx STT worker. Unlike the browser worker (vendored
 * classic glue via importScripts), the nodejs npm entry loads the same
 * wasm under Bun directly — `import sherpa from "sherpa-onnx"` works both
 * in dev (node_modules resolution) and bundled into vendor/voice/ for the
 * compiled binary (the glue reads its .wasm relative to the bundle file).
 * Session semantics come from @di/voice-engines' createSherpaSession so
 * browser + server share one implementation.
 */
import { expose } from "kkrpc/streaming";
import { workerSelfTransport } from "kkrpc/worker";
import sherpa from "sherpa-onnx";
import { createSherpaSession } from "@di/voice-engines/sherpa-session";
import type { SherpaSession } from "@di/voice-engines/sherpa-session";

export interface BuiltinSttInitArgs {
  /** absolute path to the zipformer2-ctc int8 model.onnx */
  modelPath: string;
  /** absolute path to tokens.txt */
  tokensPath: string;
}

export interface BuiltinSttApi {
  init(args: BuiltinSttInitArgs): Promise<void>;
  /** 16kHz mono Float32 frames. */
  feed(samples: Float32Array): Promise<void>;
  /** Utterance boundary: drains the stream, resolves the final transcript. */
  flush(): Promise<string>;
}

let session: SherpaSession | null = null;
let lastFinal = "";

expose(
  {
    async init(args: BuiltinSttInitArgs) {
      const recognizer = sherpa.createOnlineRecognizer({
        featConfig: { sampleRate: 16000, featureDim: 80 },
        modelConfig: {
          zipformer2Ctc: { model: args.modelPath },
          tokens: args.tokensPath,
          numThreads: 1,
          provider: "cpu",
          debug: 0,
        },
      });
      session = createSherpaSession(recognizer, recognizer.createStream(), {
        onFinal: (text) => {
          lastFinal = text;
        },
      });
      lastFinal = "";
    },
    async feed(samples: Float32Array) {
      if (!session) throw new Error("stt worker not initialized");
      session.feed(samples);
    },
    async flush() {
      if (!session) throw new Error("stt worker not initialized");
      session.flush();
      return lastFinal;
    },
  } satisfies BuiltinSttApi,
  workerSelfTransport(),
);
