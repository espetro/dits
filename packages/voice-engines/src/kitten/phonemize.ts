/**
 * Text → IPA phonemes via the espeak-ng wasm build shipped by the
 * `phonemizer` npm package. Port of kitten-tts-js src/phonemizer.js:
 * punctuation runs pass through unphonemized, everything else goes through
 * espeak en-us.
 */
// order matters: readable-async-iterator installs the Symbol.asyncIterator
// polyfill during module eval, which import order places before
// phonemizer's bundled espeak loader (it for-awaits a ReadableStream —
// needs chrome >=124 / safari >=27 / firefox >=110). the call below repeats
// it so the guarantee holds even if import order ever changes.
import { installReadableStreamAsyncIterator } from "../readable-async-iterator";
import { phonemize as espeakPhonemize } from "phonemizer";

installReadableStreamAsyncIterator();

const PUNCTUATION = ';:,.!?¡¿—…"«»""(){}[]';
const PUNCT_RE = new RegExp(
  `(\\s*[${PUNCTUATION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}]+\\s*)+`,
  "g",
);

interface Chunk {
  isPunct: boolean;
  text: string;
}

function splitPreserve(text: string, regex: RegExp): Chunk[] {
  const result: Chunk[] = [];
  let prev = 0;
  for (const match of text.matchAll(regex)) {
    const full = match[0];
    if (prev < match.index) {
      result.push({ isPunct: false, text: text.slice(prev, match.index) });
    }
    if (full.length > 0) result.push({ isPunct: true, text: full });
    prev = match.index + full.length;
  }
  if (prev < text.length) result.push({ isPunct: false, text: text.slice(prev) });
  return result;
}

export async function phonemizeText(text: string): Promise<string> {
  let processed = "";
  for (const chunk of splitPreserve(text, PUNCT_RE)) {
    if (chunk.isPunct) {
      processed += chunk.text;
    } else {
      const ipa = (await espeakPhonemize(chunk.text, "en-us")) ?? [];
      processed += ipa.join(" ").replace(/_/g, "").replace(/\n/g, " ");
    }
  }
  return processed.trim();
}
