---
name: testing-browser-voice
description: How to set up and exercise the browser-mode (wasm/builtin) voice pipeline end-to-end in apps/web — dev server selection, provider profile seeding, voice consent, fake mic, health ring, and worker debugging.
---

# Testing the browser voice pipeline (apps/web)

The app picks `BrowserVoiceDriver` when `/api/health` is unreachable. Plain `bun run dev` (vite on :5173) has no backend, so it always lands in browser mode — no server needed.

## Seeded browser state

Set these in devtools console before starting an interview (browser-mode interviews need an LLM endpoint or turns do nothing):

```js
localStorage.setItem(
  "di.provider-profile",
  JSON.stringify({
    llm: { baseUrl: "http://localhost:9000/v1", apiKey: "mock", model: "mock-llm", mode: "remote" },
  }),
);
localStorage.setItem("di.voice.modelsConsent", "granted"); // skips the consent dialog
```

Mock provider: `bun run packages/evals/mock-provider/main.ts --port 9000` (canned replies, CORS-enabled).

## Fake microphone

The computer/browser_console tools attach to the session-managed Chrome for Testing at `/opt/.devin/chrome/chrome/linux-*/chrome-linux64/chrome` on `--remote-debugging-port=29229` with `--user-data-dir=/home/ubuntu/.browser_data_dir`. To get a fake mic, kill that process and relaunch it with the SAME argv plus:

```
--use-fake-device-for-media-stream --use-fake-ui-for-media-stream
--use-file-for-fake-audio-capture=/tmp/speech_loop.wav
```

Do NOT spawn a second Chrome on a different port/profile — browser_console won't reach it. `/tmp` is wiped between runs: recreate the wav before relaunching (ffmpeg concat of HF `csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26` `test_wavs/0.wav` + ~3.5s `anullsrc` silence + `1.wav` + ~3s silence, `-ar 16000 -ac 1`, verify with `-af silencedetect`).

`speech_loop.wav`: 16kHz mono PCM16 real speech plus a few seconds of trailing silence so the silero VAD endpoints each loop. A continuously-looping file may never trigger VAD speech-end — sherpa produces partials but no flush/final turn; vary silence length or stop/restart capture if finals never arrive.

## Health ring

`window.voiceHealth` exists ONLY in `import.meta.env.DEV` builds (vite dev). `vite build` — even `--mode development` — strips the window mirror; only the `$voiceHealth` nanostore remains. For prod-bundle debugging add a logging static server and read `engine.boot` events via console events instead.

## Known pitfalls (as of the vendored sherpa build)

- **The silero VAD is a no-op in manual-feed mode.** `createVadGate` uses `MicVAD.new({startOnLoad:false})` and never calls `start()` — but vad-web 0.0.30's `FrameProcessor.process()` early-returns while `frameProcessor.active===false`, and `active` is only set by `frameProcessor.resume()` inside `MicVAD.start()`. Result: `onSpeechStart`/`onSpeechEnd`/`onFrameProcessed` NEVER fire → no utterance_end (server driver), no `stt.flush`→final (wasm stt), and the adaptive echo gate can never earn `allowed:true`. Symptom: partials grow forever, no user turns, no `vad-frame` gate events. To activate a live instance in devtools: `mic.frameProcessor.resume()` — reach it by wrapping `MicVAD.new` (see below).
- **vite `?v=<browserHash>` module-identity trap.** `import("…/deps/x.js?v=A")` and `…?v=B` are DIFFERENT module instances — patching a class on one won't affect code using the other. Get the exact URL the app uses from its transformed source (`curl http://localhost:5173/src/lib/voice/vad.ts | grep deps`) or `_metadata.json` `browserHash`. After a mid-session vite re-optimization the loaded page keeps stale URLs — `import()` of old hashes 404s, and a stale-vs-current dep mix can crash the app (`Cannot read properties of null (reading 'useContext')`); reload for a clean graph. Worker-context fetches carry their own hashes (visible in `performance.getEntriesByType("resource")`), don't confuse them with the main graph.
- **Pre-loading a dep in devtools shares the app's instance.** `await import("/node_modules/.vite/deps/<dep>.js?v=<hash>")` before the app lazily imports it returns the same module — wrap the class there (e.g. `MicVAD.new`) and the app's later construction hits your wrapper.
- `stt-worker.ts` MUST have zero static (non-type) imports — vite only emits a classic-worker bundle then. With static imports, dev serves it transformed (`import "/@vite/env"` + bare `import`s) → SyntaxError in classic workers → `worker.error` fires but `api.init()` hangs ~120s (RPC_TIMEOUT_MS) → UI sits at "connecting…" for minutes before builtin fallback. Prod `vite build` emits a clean iife, so this failure is dev-only.
- **Vendored sherpa glue puts `FS` on worker `globalThis`, not `Module`.** The flat classic script `sherpa-onnx-wasm-main-asr.js` declares top-level `var FS`, `var Module` — `Module` is read from the seeded `g.Module` (locateFile/onRuntimeInitialized) but `FS` is a fresh global. Code doing `mod.FS.writeFile(...)` throws `TypeError: reading 'writeFile'`; use `self.FS.writeFile` or `Module.FS_createDataFile`. To test a fix without rebuilding: copy the built `/assets/stt-worker-*.js` to `dist/client/assets/stt-worker-patched.js` (gitignored), edit it, and patch `window.Worker` to redirect `stt-worker` URLs → `/@fs/home/ubuntu/repos/dits/apps/web/dist/client/assets/stt-worker-patched.js` (dev only).
- **kkrpc worker wire format** (for message taps / direct calls): requests `{t:"q", id, op:"call"|"get"|"set"|"new", p:["method"], a:[{__kkrpc_next_arg__:"value",v:…}]}`, responses `{t:"r", id, v|e:{n,m,s}}`, callback invocations `{t:"cb", id, a:[{v:text}]}` (partials AND finals share this shape, distinguished by callback id), stream control `{t:"sq"|"sr", sid}`. You can force a worker-side `flush()` by posting `{t:"q", id:"x", op:"call", p:["flush"], a:[]}` to a captured Worker — useful when the VAD path is broken.
- `driver.restart()` (the "retry voice" button) never re-attempts wasm stt after a boot failure — the driver mutates the resolved engine to builtin. Reload or start a fresh interview to re-test wasm boot.
- The error toast only fires on the first error transition (`voiceErroredRef`); retries don't re-toast. To capture `voice.error` text, reload the interview page.
- `vite preview` does NOT work for this SPA-only build (expects `dist/client/server/server.js`). Use a tiny Bun static server with index.html fallback to serve `dist/client`.
- The interview route installs a beforeunload guard — `location.href` navigation throws a native "Leave site?" dialog; leave via the UI ("end interview" → "end early") or click through the dialog.
- `browser_console` does not await promises — stash async results on `window.__x` and read them on a later call.

## Devin Secrets Needed

None for browser-mode voice testing. `HF_SECRET` is only needed if huggingface.co rate-limits model downloads (~50MB).
