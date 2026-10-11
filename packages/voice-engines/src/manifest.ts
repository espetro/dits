import type { VoiceModelManifest } from "@di/shared";

/** Baked-in manifest: sherpa-onnx zipformer2-ctc small (stt) + KittenTTS nano (tts). */
export const DEFAULT_VOICE_MODEL_MANIFEST: VoiceModelManifest = {
  version: 1,
  models: {
    stt: {
      version: "zipformer2-ctc-en-small-2024-03-18",
      files: [
        {
          path: "stt/model.onnx",
          url: "https://huggingface.co/csukuangfj/icefall-asr-librispeech-streaming-zipformer-small-2024-03-18/resolve/main/exp-ctc-rnnt-small/ctc-epoch-30-avg-3-chunk-16-left-128.int8.onnx",
          size: 26_247_460,
          sha256: "d6746f4a034deea74b91091300eecc821e653fc8439a566cb8b5ba2d7a62bfd9",
        },
        {
          path: "stt/tokens.txt",
          url: "https://huggingface.co/csukuangfj/icefall-asr-librispeech-streaming-zipformer-small-2024-03-18/resolve/main/data/lang_bpe_500/tokens.txt",
          size: 5_048,
          sha256: "49e3c2646595fd907228b3c6787069658f67b17377c60aeb8619c4551b2316fb",
        },
      ],
    },
    tts: {
      version: "kitten-tts-nano-0.1",
      files: [
        {
          path: "tts/model.onnx",
          url: "https://huggingface.co/KittenML/kitten-tts-nano-0.1/resolve/main/kitten_tts_nano_v0_1.onnx",
          size: 23_847_845,
          sha256: "8818e8f06eb34bc9d17ba3987a9b513c5759e2f5f119b1242cfbb503d12bdc0a",
        },
        {
          path: "tts/voices.npz",
          url: "https://huggingface.co/KittenML/kitten-tts-nano-0.1/resolve/main/voices.npz",
          size: 10_294,
          sha256: "d1f3b3ce46c5fa79fa0019824bf572fea74f6a84c88b079cfecd700118d00b62",
        },
      ],
    },
  },
};

/** Cache key for one manifest file (synthetic url for CacheStorage). */
export function modelFileKey(modelId: string, version: string, path: string): string {
  return `https://di.local/voice-models/${modelId}/${path}?v=${encodeURIComponent(version)}`;
}
