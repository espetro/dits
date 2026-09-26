# e2e: wasm voice (consent, downloader, engine path)

Covers the on-device voice stack end to end in a real browser without
shipping the ~50MB models: `localStorage["di.voice.models-base"]` points
the manifest+file fetches at `page.route` stubs (tiny bytes whose sha256
the spec computes), and `window.Worker` is replaced by a mock that speaks
the sherpa/kitten worker protocols. Requires the web dev server
(DI_WEB_URL) plus chromium fake-media launch flags — no di server, the LLM
endpoint is routed like the client-only suite.

## consent dialog opens on first browser-mode entry and accept downloads the models

Seed client-only localStorage with consent unset, land on `/interview/[id]`:
the consent dialog appears. Accept fetches `manifest.json` and all four
model files, verifies sha256, and writes them to the `di-voice-models`
cache; `di.voice.modelsConsent` persists as `granted`.

## decline keeps built-in engines and never re-asks

Decline the dialog: no model fetch happens, consent persists as
`declined`, and a page reload does not re-show the dialog (the wasm
switch is re-armed only via Settings -> voice).

## wasm engines run a full turn loop on mock workers

With consent granted and the cache pre-seeded, the interview driver skips
SpeechRecognition entirely: the mock stt worker boots, fake-media mic
frames flow through `onFloat32Frame`, the mock emits a final
("hello from wasm"), a real agent turn runs against the routed LLM
endpoint, and the reply is synthesized through the mock tts worker into
`PcmPlayer.writeFloat32` — transcript shows both turns.
