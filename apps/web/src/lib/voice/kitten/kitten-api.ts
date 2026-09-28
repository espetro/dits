/**
 * KittenTTS worker api. Owns the onnxruntime-web wasm session, the
 * voices.npz style table and the espeak-ng phonemizer; the main thread only
 * sends text and gets 24kHz Float32 PCM back.
 *
 * Model bytes arrive over postMessage (already downloaded + sha-verified by
 * the manifest downloader); ort itself loads from the vendored
 * ort.wasm.bundle.min.mjs + ort-wasm-simd-threaded.wasm in /vad/ (both 1.29.0)
 * rather than the npm bundle — a static import would make vite emit ort's
 * unused wasm variants into dist/assets and blow past the Pages asset cap.
 */
import type * as Ort from "onnxruntime-web";
import { transfer } from "kkrpc/streaming";

import { loadNpz } from "./npz";
import type { NpyArray } from "./npz";
import { phonemizeText } from "./phonemize";
import { basicEnglishTokenize, cleanText } from "./text-cleaner";

export interface KittenInitArgs {
  model: ArrayBuffer;
  voices: ArrayBuffer;
  wasmBase: string;
}

export interface KittenTtsApi {
  /** Loads ort + the inference session; rejects with the init failure. */
  init(args: KittenInitArgs): Promise<void>;
  /**
   * Synthesizes one utterance; the pcm resolves in ~340ms chunks so the
   * consumer can start playback early and cancel mid-stream (the remote
   * iterator's return() runs this generator's finally, freeing the slot).
   */
  speak(text: string): AsyncIterable<Float32Array>;
  /** Drop queued-but-not-started speaks (barge-in); in-flight runs finish. */
  clear(): Promise<void>;
}

/** kitten output carries trailing tail noise; drop the last N samples */
const AUDIO_TRIM = 5_000;
const DEFAULT_VOICE = "expr-voice-5-m";
/** ~340ms of pcm at 24kHz per yielded chunk */
const CHUNK_SAMPLES = 8_192;

export function createKittenApi(): KittenTtsApi {
  let ort: typeof Ort | null = null;
  let session: Ort.InferenceSession | null = null;
  let voices: Record<string, NpyArray> = {};

  /** serializes session.run: concurrent runs on one ort wasm session
   * interleave and emit pcm out of order */
  let tail: Promise<void> = Promise.resolve();
  /** bumped by clear(): queued speaks captured before the bump are dropped */
  let generation = 0;

  async function synthesize(text: string): Promise<Float32Array> {
    if (!session || !ort) throw new Error("worker not initialized");
    const voiceEntry = voices[DEFAULT_VOICE] ?? Object.values(voices)[0];
    if (!voiceEntry) throw new Error("voices.npz is empty");
    const [numStyles = 0, styleDim = 0] = voiceEntry.shape;

    const phonemes = await phonemizeText(text);
    const tokenIds = cleanText(basicEnglishTokenize(phonemes).join(" "));
    const refId = Math.min(tokenIds.length, numStyles - 1);
    const style = voiceEntry.data.slice(refId * styleDim, (refId + 1) * styleDim);

    const results = await session.run({
      input_ids: new ort.Tensor("int64", BigInt64Array.from(tokenIds.map((i) => BigInt(i))), [
        1,
        tokenIds.length,
      ]),
      style: new ort.Tensor("float32", style, [1, styleDim]),
      speed: new ort.Tensor("float32", new Float32Array([1]), [1]),
    });
    const out = results[Object.keys(results)[0] ?? ""];
    if (!out) throw new Error("model returned no outputs");
    return (out.data as Float32Array).slice(
      0,
      Math.max(0, (out.data as Float32Array).length - AUDIO_TRIM),
    );
  }

  return {
    async init(args) {
      ort = (await import(
        /* @vite-ignore */ `${args.wasmBase}ort.wasm.bundle.min.mjs`
      )) as typeof Ort;
      ort.env.wasm.wasmPaths = args.wasmBase;
      // single-threaded: the app does not require cross-origin isolation, so
      // the threaded pool / proxy worker path is off
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      session = await ort.InferenceSession.create(args.model, { executionProviders: ["wasm"] });
      voices = await loadNpz(args.voices);
    },

    speak(text) {
      const gen = generation;
      // chain the slot at call time so call order == run order even before
      // the consumer starts pulling the stream
      let release!: () => void;
      const myTurn = tail;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      return (async function* () {
        try {
          await myTurn;
          if (gen !== generation) throw new Error("cleared");
          const pcm = await synthesize(text);
          for (let off = 0; off < pcm.length; off += CHUNK_SAMPLES) {
            const chunk = pcm.slice(off, off + CHUNK_SAMPLES);
            yield transfer(chunk, [chunk.buffer]);
          }
        } finally {
          release();
        }
      })();
    },

    async clear() {
      generation += 1;
      // abandon the queue chain so a never-started generator cannot stall it
      tail = Promise.resolve();
    },
  };
}
