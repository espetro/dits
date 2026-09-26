/// <reference lib="webworker" />
/**
 * KittenTTS inference worker. Owns the onnxruntime-web wasm session, the
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
import { loadNpz } from "./npz";
import type { NpyArray } from "./npz";
import { phonemizeText } from "./phonemize";
import { basicEnglishTokenize, cleanText } from "./text-cleaner";

export interface KittenInitMsg {
  type: "init";
  model: ArrayBuffer;
  voices: ArrayBuffer;
  wasmBase: string;
}
export interface KittenSpeakMsg {
  type: "speak";
  id: number;
  text: string;
}
export type KittenInMsg = KittenInitMsg | KittenSpeakMsg;

export type KittenOutMsg =
  | { type: "ready" }
  | { type: "pcm"; id: number; pcm: Float32Array }
  | { type: "error"; id: number | null; message: string };

/** kitten output carries trailing tail noise; drop the last N samples */
const AUDIO_TRIM = 5_000;
const DEFAULT_VOICE = "expr-voice-5-m";

let ort: typeof Ort | null = null;
let session: Ort.InferenceSession | null = null;
let voices: Record<string, NpyArray> = {};

function post(msg: KittenOutMsg, transfer?: Transferable[]): void {
  (self as unknown as Worker).postMessage(msg, transfer ?? []);
}

async function init(msg: KittenInitMsg): Promise<void> {
  ort = (await import(/* @vite-ignore */ `${msg.wasmBase}ort.wasm.bundle.min.mjs`)) as typeof Ort;
  ort.env.wasm.wasmPaths = msg.wasmBase;
  // single-threaded: the app does not require cross-origin isolation, so the
  // threaded pool / proxy worker path is off
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  session = await ort.InferenceSession.create(msg.model, { executionProviders: ["wasm"] });
  voices = await loadNpz(msg.voices);
}

async function speak(id: number, text: string): Promise<void> {
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
  const pcm = (out.data as Float32Array).slice(
    0,
    Math.max(0, (out.data as Float32Array).length - AUDIO_TRIM),
  );
  post({ type: "pcm", id, pcm }, [pcm.buffer]);
}

self.onmessage = (ev: MessageEvent<KittenInMsg>) => {
  const msg = ev.data;
  void (async () => {
    if (msg.type === "init") {
      await init(msg);
      post({ type: "ready" });
    } else {
      await speak(msg.id, msg.text);
    }
  })().catch((err: unknown) => {
    post({
      type: "error",
      id: msg.type === "speak" ? msg.id : null,
      message: err instanceof Error ? err.message : String(err),
    });
  });
};
