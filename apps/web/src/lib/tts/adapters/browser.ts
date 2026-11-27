import { DiError } from "../../errors";
import { TTS_TEST_TIMEOUT_MS } from "../../timeouts";

/** In-browser TTS test: resolve on `end`, reject on `error` or timeout. */
export function testBrowserTts(text = "hello"): Promise<void> {
  const synth = globalThis.speechSynthesis;
  if (!synth) return Promise.reject(new DiError("tts.builtin", undefined, "no speechSynthesis"));
  // desktop shells and headless browsers expose the api with zero voices:
  // speak() then neither plays nor errors, which looked like a passing test
  if (synth.getVoices().length === 0)
    return Promise.reject(new DiError("tts.builtin", undefined, "no voices installed"));
  return new Promise<void>((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(text);
    const timer = setTimeout(() => {
      synth.cancel();
      resolve();
    }, TTS_TEST_TIMEOUT_MS);
    utterance.onend = () => {
      clearTimeout(timer);
      resolve();
    };
    utterance.onerror = (event) => {
      clearTimeout(timer);
      reject(new DiError("tts.builtin", undefined, event.error));
    };
    synth.speak(utterance);
  });
}
