# browser wasm stt reassessment

date: 2026-09-28
status: proposal, awaiting pick
scope: browser-first wasm stt (priority path) + desktop sidecar parity

## finding

`sherpa-onnx` npm (checked 1.13.8, latest) ships only `sherpa-onnx-wasm-nodejs.js/.wasm`
— node-targeted emscripten glue with unconditional `require("path")`/`fs`/`crypto`. it has
never executed in a real browser; the wasm stt path has never booted outside the harness.

upstream **does** publish browser wasm builds, but as per-model release tarballs, not on
npm. `v1.13.7` ships `sherpa-onnx-wasm-simd-v1.13.7-en-asr-zipformer.tar.bz2` (167MB
compressed): `sherpa-onnx-wasm-main-asr.js` glue (84K), `.wasm` (13MB), `.data` (183MB —
an emscripten file-packager blob containing their transducer zipformer: encoder.onnx +
decoder.onnx + joiner.onnx + tokens.txt), plus the same `sherpa-onnx-asr.js` api surface
our worker already calls. no SharedArrayBuffer/pthread requirement — no cross-origin
isolation needed on the static host.

v1.13.8's release has no asr wasm asset (tts/vad/diarization only) — asr assets appear
intermittently per release.

## upstream posture

- issue k2-fsa/sherpa-onnx#1727 "Improve WASM support/packaging" (open) is exactly this
  ask — npm/browser-friendly wasm packaging. maintainer (csukuangfj) position: "you MUST
  build it by yourself, since you need to pre-package the model files" — per-model `.data`
  bundling is by design; open to contributions. no new issue needed; #1727 is the tracker.
- open pr k2-fsa/sherpa-onnx#2099 (single-file wasm build for web/react-native) is related
  upstream work to watch.

## options

### a. vendor official browser wasm + repacked `.data` (recommended)

take `sherpa-onnx-wasm-main-asr.js` + `.wasm` (13.1MB) from the official tarball. the glue
unconditionally fetches its `.data` at init via `Module.locateFile`, writing files to MEMFS
per an embedded `metadata` block (`{filename,start,end}` + `remote_package_size`). we
generate our own `.data` — flat concat of our zipformer2-ctc `model.onnx` (26MB) +
`tokens.txt` — and patch the glue's embedded metadata to match. `sherpa-onnx-asr.js` and
the worker's `createOnlineRecognizer(mod, {zipformer2Ctc:{model:"model.onnx"}, ...})`
call stay unchanged; `FS.writeFile` can keep working too (alternative: 1-byte stub `.data`).

- pros: no emscripten toolchain, official build artifacts, same api, keeps our model
  manifest/cache exactly as-is, ~39MB total payload (13MB wasm + 26MB model) vs the 183MB
  upstream bundle
- cons: glue metadata patch is version-pinned (mitigate: pin the tarball, contract-test the
  patch applied + worker reaches ready)
- effort: ~half a session incl. verification

### b. self-build with emsdk

`wasm/asr/build-wasm-simd-asr.sh` + our model in `assets/` → custom glue/wasm/.data.
full control, reproducible in ci, but ~1GB toolchain + a C++ wasm compile per version bump.
fallback if (a) proves fragile across bumps.

### c. use the official tarball as-is

183MB download per user. rejected — kills the "small download" story.

### d. alternative engines (rejected for the flagship path)

- `@huggingface/transformers` + moonshine-tiny/base: en-only, chunked not streaming.
- transformers.js + whisper-tiny: multilingual but non-streaming — worse turn UX, and
  quality at tiny size is marginal for interviews.
- vosk-browser: real streaming, but aging accuracy and ecosystem.
- none give streaming zipformer quality, and all break engine parity with the sidecar.

## recommendation

stay on sherpa-onnx; implement (a). the worker integration is unchanged (classic worker +
importScripts + MEMFS) — only the asset urls change from `sherpa-onnx/...nodejs.*` package
files to vendored browser artifacts under `apps/web/public/wasm/sherpa/` (or `?url`
imports from a vendored dir). keep the 1.13.7 tarball pinned; bump deliberately.

sidecar parity: native sherpa-onnx in the .cpp sidecar with the same zipformer2-ctc model
gives free parity — same engine family, same model files, no new work beyond the existing
"sidecar stt/tts preset" item.

## follow-ups once wasm stt boots

- dev-mode caveat from w7: vite dev serves classic workers as transformed esm → parse
  error, fails fast to builtin (prod build fine). if dev-mode stt matters, gate the sherpa
  worker behind a prod-build check or move init into the worker differently.
- non-en stt is a separate roadmap item — manifest is single-model; multilingual
  streaming (e.g. zh-en zipformer) can join the manifest later.
