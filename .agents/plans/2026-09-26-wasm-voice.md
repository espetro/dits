# plan: wasm stt/tts for browser mode

status: draft
source: stt/tts research report (2026-09-26) + chrome webspeech mic-strobe
diagnosis
related: adr-0003 (client-only static), remediation plan p0-p6

## 0. problem

browser mode voice today = web speech api stt + speechsynthesis tts:

- stt runs chrome-managed capture sessions that get destroyed/recreated on
  every `onend` -> os mic indicator strobes, cloud-dependent, uncontrolled
  disconnects, restart-loop hazards (zombie `start()` after `stop()`).
- tts quality is the weakest link: speechsynthesis voices read as robotic
  next to any real product.
- both are chrome-only: firefox/safari degrade to text-first.

fix direction: on-device wasm engines replace webspeech as the default in
browser mode; webspeech stays as the zero-download fallback. the mic-strobe
hotfix (anchor stream + tracked restart timer) landed alongside this doc;
wasm is the permanent fix.

## 1. model picks (least total mb)

scored against the research matrix; pick the smallest options that still
score >8 on naturalness + latency:

| role | pick                                   | size   | why                                                                                                 |
| ---- | -------------------------------------- | ------ | --------------------------------------------------------------------------------------------------- |
| stt  | sherpa-onnx streaming zipformer (int8) | ~25 mb | true streaming transducer, real-time token emission (~50-80ms), onnx-free custom wasm build         |
| tts  | kittentts nano 15m                     | ~24 mb | ~60-120ms sentence latency, warm prosody, runs on onnxruntime-web (already vendored for silero vad) |
| vad  | silero (already vendored)              | ~2 mb  | keeps endpointing + barge-in; unchanged                                                             |

total new download: ~50 mb once, cached afterwards. alternates if a pick
fails validation: moonshine tiny (~26 mb, vad-chunked, simpler api) for stt;
piper medium (~35-55 mb) for tts. kokoro-82m (~85 mb) stays out - breaks
the least-mb budget.

## 2. architecture

wasm engines slot behind two new engine interfaces inside
`BrowserVoiceDriver` - the driver keeps owning turn orchestration, the
engines only do recognition/synthesis. server mode is untouched (sidecar
stt/tts stays server-side).

```ts
// lib/voice/engines.ts
interface SttEngine {
  start(opts: {
    onFinal(text: string): void;
    onInterim(text: string): void;
    onSpeechStart(): void;
  }): Promise<void>;
  feed(frame: Float32Array): void; // 16khz mono float32
  stop(): Promise<void>;
}
interface TtsEngine {
  speak(sentence: string): Promise<Float32Array>; // pcm at engine rate
  dispose(): void;
}
```

adapters:

- `WebSpeechStt` - today's `SpeechRecognition` path (0 mb, fallback).
- `WasmStt` - `MicCaptureImpl` (16k audioctx + worklet, already exists) feeds
  float32 frames to a dedicated worker running sherpa-onnx zipformer; silero
  vad gate keeps endpointing + barge-in (already vendored). replaces
  `handleResult` with `onFinal`/`onInterim` callbacks into the same
  `runAgentTurn` path.
- `SpeechSynthTts` / `EndpointTts` - today's speechsynthesis + byo
  `/v1/audio/speech` paths.
- `WasmTts` - kittentts in a worker; output 24khz float32 -> `PcmPlayer`
  gains a `writeFloat32(samples)` entry (pcm16 stays for the ws path).

audio notes from the report we already satisfy: native
`AudioContext({sampleRate:16000})` resampling (capture.ts), worklet batching.
skip `SharedArrayBuffer`/ring-buffer until profiling proves postMessage is a
problem. float32 end-to-end on the wasm path; pcm16 stays only on the
server ws wire.

### model hosting + caching

models are NOT committed to git. `VITE_VOICE_MODELS_BASE` env (build-time)
points at the asset root - default our r2/static host when deployed; dev
can point at huggingface cdns or a local dir. manifest json lists
{url,size,sha256,version} per model; downloader writes to cachestorage
(opfs fallback) with per-file progress events. first load verifies sha;
version bumps re-download.

## 3. consent ux

browser mode defaults to wasm engines, gated on explicit consent:

- first voice interview (or settings): dialog "di works best with on-device
  voice models (~50 mb download, cached afterwards, fully private).
  [download for better voices] [continue with basic voices]".
- declining = silent fallback to builtin (webspeech stt + speechsynthesis),
  no re-nagging.
- settings -> voice section: engine pickers
  (stt: `on-device | browser built-in`; tts: `on-device | browser built-in |
custom endpoint`), download state line ("downloaded, 52 mb" /
  "not downloaded" / progress), "re-download" + "clear cached models".
- download failure or missing wasm/simd support -> auto-fallback to builtin
  with a status note, never a dead voice loop.

persisted store keys: `di.voice.sttEngine`, `di.voice.ttsEngine`,
`di.voice.modelsConsent` (`granted|declined`).

## 4. phases

- a (this pr): mic-strobe hotfix in browser-driver (anchor stream, tracked
  restart timer, `abort()` teardown) - keeps webspeech usable meanwhile.
- b: engine interfaces + model manifest/downloader/caches + consent dialog +
  settings pickers, with stub engines behind them.
- c: wasm tts first (kittentts worker) - voice quality is the visible win.
- d: wasm stt (sherpa zipformer worker + float32 capture feed) - retires
  webspeech as default; kills the strobe/root cause permanently.
- e: e2e + docs (screens/settings spec update, stack.md, AGENTS voice
  section), verify offline-mode story after first cache.

open: exact sherpa-onnx-wasm packaging (npm vs vendored build), kittentts
onnx graph compat with onnxruntime-web on safari, mobile memory budget.
