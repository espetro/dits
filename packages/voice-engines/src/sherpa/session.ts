/**
 * sherpa-onnx recognizer session: the decode/drain/utterance logic shared
 * by the browser worker (vendored classic glue, MEMFS model) and the server
 * worker (sherpa-onnx npm node glue, fs model paths). Each side constructs
 * the recognizer its own way; this owns feed -> decode -> partial/final.
 */

export interface SherpaStream {
  acceptWaveform(sampleRate: number, samples: Float32Array): void;
  inputFinished(): void;
}

export interface SherpaRecognizer {
  createStream(): SherpaStream;
  isReady(stream: SherpaStream): boolean;
  decode(stream: SherpaStream): void;
  isEndpoint(stream: SherpaStream): boolean;
  reset(stream: SherpaStream): void;
  getResult(stream: SherpaStream): { text?: string };
}

export interface SherpaSessionCallbacks {
  /** Fires when the running transcript changes (non-empty). */
  onPartial?: (text: string) => void;
  /** Fires once per finished utterance with its final transcript. */
  onFinal?: (text: string) => void;
}

export interface SherpaSession {
  /** 16kHz mono Float32 frames. */
  feed(samples: Float32Array): void;
  /** Utterance boundary: drains the stream and emits the final transcript. */
  flush(): void;
  /** The last decoded text (partial or final). */
  readonly lastText: string;
}

export function createSherpaSession(
  recognizer: SherpaRecognizer,
  stream: SherpaStream,
  callbacks: SherpaSessionCallbacks = {},
): SherpaSession {
  let lastPartial = "";

  /** Decode pending frames; emit a partial only when the text actually moved. */
  function decodeStep(): void {
    while (recognizer.isReady(stream)) recognizer.decode(stream);
    const text = recognizer.getResult(stream).text ?? "";
    if (text !== lastPartial) {
      lastPartial = text;
      if (text) callbacks.onPartial?.(text);
    }
  }

  /** Utterance boundary (vad speech end, or sherpa's own endpoint). */
  function finishUtterance(): void {
    decodeStep();
    callbacks.onFinal?.(lastPartial);
    recognizer.reset(stream);
    lastPartial = "";
  }

  return {
    feed(samples) {
      stream.acceptWaveform(16000, samples);
      decodeStep();
      // sherpa's trailing-silence rules as a backstop for vad endpointing
      if (recognizer.isEndpoint(stream)) finishUtterance();
    },
    flush() {
      stream.inputFinished();
      finishUtterance();
    },
    get lastText() {
      return lastPartial;
    },
  };
}
