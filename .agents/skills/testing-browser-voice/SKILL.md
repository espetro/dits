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

Relaunch Chrome for Testing with:

```
--use-fake-device-for-media-stream --use-fake-ui-for-media-stream
--use-file-for-fake-audio-capture=/tmp/speech_loop.wav
```

`speech_loop.wav`: 16kHz mono PCM16 real speech plus a few seconds of trailing silence so the silero VAD endpoints each loop. A continuously-looping file may never trigger VAD speech-end — sherpa produces partials but no flush/final turn; vary silence length or stop/restart capture if finals never arrive.

## Health ring

`window.voiceHealth` exists ONLY in `import.meta.env.DEV` builds (vite dev). `vite build` — even `--mode development` — strips the window mirror; only the `$voiceHealth` nanostore remains. For prod-bundle debugging add a logging static server and read `engine.boot` events via console events instead.

## Known pitfalls (as of the kkrpc worker refactor)

- `stt-worker.ts` MUST have zero static (non-type) imports — vite only emits a classic-worker bundle then. With static imports, dev serves it transformed (`import "/@vite/env"` + bare `import`s) → SyntaxError in classic workers → `worker.error` fires but `api.init()` hangs ~120s (RPC_TIMEOUT_MS) → UI sits at "connecting…" for minutes before builtin fallback. Prod `vite build` emits a clean iife, so this failure is dev-only.
- `sherpa-onnx` ships `sherpa-onnx-wasm-nodejs.js` glue that calls `require("path")` unconditionally inside `Module()` and throws `NODERAWFS is currently only supported on Node.js` — it cannot run in a stock browser worker. To exercise the real stt worker anyway, serve a wrapper via vite `/@fs/<abs path>` that stubs `self.require`/`self.process`/`__dirname`/`module` and minimal `fs` (readFileSync via sync XHR, openSync/fstatSync/readSync/closeSync fd map, stat objects need `mtime`/`mtimeMs`/`ino`/`dev`), then patch `window.Worker` to redirect `stt-worker` URLs to the wrapper. Patch after page load, before interview start; SPA navigation preserves it, hard reloads wipe it.
- `driver.restart()` (the "retry voice" button) never re-attempts wasm stt after a boot failure — the driver mutates the resolved engine to builtin. Reload or start a fresh interview to re-test wasm boot.
- The error toast only fires on the first error transition (`voiceErroredRef`); retries don't re-toast. To capture `voice.error` text, reload the interview page.
- `vite preview` does NOT work for this SPA-only build (expects `dist/client/server/server.js`). Use a tiny Bun static server with index.html fallback to serve `dist/client`.
- The interview route installs a beforeunload guard — `location.href` navigation throws a native "Leave site?" dialog; leave via the UI ("end interview" → "end early") or click through the dialog.
- `browser_console` does not await promises — stash async results on `window.__x` and read them on a later call.

## Devin Secrets Needed

None for browser-mode voice testing. `HF_SECRET` is only needed if huggingface.co rate-limits model downloads (~50MB).
