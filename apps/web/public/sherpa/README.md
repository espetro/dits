# vendored sherpa-onnx browser build

apache-2.0, © k2-fsa / sherpa-onnx project — pinned to release `v1.13.7`:

- `sherpa-onnx-wasm-main-asr.js` — emscripten glue (patched, see below)
- `sherpa-onnx-wasm-main-asr.wasm` — wasm runtime (~13MB)
- `sherpa-onnx-asr.js` — recognizer api (verbatim tarball copy)
- `sherpa-onnx-wasm-main-asr.data` — 1-byte stub: the upstream `.data` blob
  packs THEIR transducer model (~190MB); the glue's embedded
  `loadPackage({files, remote_package_size})` metadata is patched to a
  single `/.stub` entry so the fetch stays a no-op — our zipformer2-ctc
  model bytes arrive via the voice model manifest + `FS.writeFile`.

the npm package (`sherpa-onnx@1.13.x`) only ships the nodejs glue —
unconditional `require("path"|"fs"|"crypto")` + `NODERAWFS` — so it can
never run in a browser worker. this vendored build is the browser wasm
path.

regenerate: `bun scripts/repack-sherpa-stt.ts` (downloads the pinned
tarball, patches, emits here — bump `VERSION` there to upgrade).
