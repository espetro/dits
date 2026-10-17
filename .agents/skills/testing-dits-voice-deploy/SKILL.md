---
name: testing-dits-voice-deploy
description: How to E2E-test the deployed dits voice flagship (browser WASM STT/TTS + cloud LLM) with a fake mic, including the api.illo.fyi CORS gotcha, worker-sniffing instrumentation, and self-test shortcuts.
---

# Testing the dits deployed voice flagship

Target: https://dits.illo.fyi (Cloudflare Pages, static → always clientOnly/browser driver).

## Fake-mic Chrome setup

Relaunch Chrome for Testing with:
```
--use-fake-device-for-media-stream
--use-file-for-fake-audio-capture=/path/fake-mic.wav   # 16k mono s16 wav
--use-fake-ui-for-media-stream                        # auto-accepts mic prompts
--autoplay-policy=no-user-gesture-required            # AudioContext can start
```
The WAV **restarts from the top on every new getUserMedia** (each driver boot /
"retry voice" click), so build a repeating pattern:
`[4s silence -> ~10s speech -> ~26s silence -> ~9s speech -> ~30s silence] x N`.
Distinctive long-form speech (e.g. whisper.cpp jfk.wav + harvard-sentence OSR
samples) makes sherpa transcripts instantly recognizable vs any builtin STT.

Preserve Chrome args in a bash array launcher — `$(cat args)` unquoted splits the
user-agent on spaces and opens junk tabs. Screenshot coords on this box:
`click_x = css_x * 0.64`, `click_y = (53 + css_y) * 0.684` (screenshot space
1024x768 vs 1600x1069 viewport).

## KNOWN BLOCKER: api.illo.fyi CORS

The deployed demo's baked LLM endpoint (`https://api.illo.fyi/v1`, key `demo`,
model `illo-demo`) fails 100% in-browser: the gateway's OPTIONS response
`access-control-allow-headers: content-type, cf-turnstile-token` omits
`authorization`, and the app sends `Authorization: Bearer` unconditionally →
preflight fails → every turn ends in `AI_NoOutputGeneratedError` + "the agent
model failed" toast. The same POST *without* Authorization returns 200+SSE, so
the gateway itself does not require auth for the demo.

Workaround for testing: run a tiny localhost proxy that forwards to
api.illo.fyi and answers OPTIONS with `allow-headers: *`, then point the app's
BYO endpoint at `http://localhost:8787/v1` (settings > interviewer ai). The
upstream still 503s ~2-in-3 requests (10rpm + 30/day caps) — probe
`curl -s -o /dev/null -w %{http_code} .../chat/completions` in a loop and fire a
turn the instant a 200 window opens; each turn also retries once internally.

## Settings self-tests (fast TTS/STT probes, no interview needed)

Account menu (top-right avatar) > Settings > voice & microphone:

- "play sample" runs `engine.speak(testPhrase)` directly and prints ms latency —
  a ms number proves the **wasm** branch ran; a bare ok means builtin fallback;
  an error toast means wasm failed.
- "run test" = full loop ("says hello back, then listens") — prints
  `understands you with: Working` / `answers you with: Working`.
- "on-device voice pack" row shows installed MB (~47.8mb = all 4 files:
  stt/model.onnx 26247460, stt/tokens.txt 5048, tts/model.onnx 23847845,
  tts/voices.npz 10294 — verify via `caches.open('di-voice-models')`).

## Instrumentation that actually works here

- `window.voiceHealth` is dev-build only; prod exposes a 300-entry event ring
  internally (`engine.boot`, `tts.speak` events) but it is not reachable.
- The deployed build uses **kkrpc** over workers, not the raw
  `{type:...}` protocol in `apps/web/src/lib/voice/wasm-engines.ts` — worker
  envelopes look like `{t:'q',op:'call',p:['speak']}`, streaming uses
  `sq:pull`/`sr` responses. Sniff with
  `Worker.prototype.postMessage` (outgoing) AND `addEventListener('message')`
  wrap (incoming — kkrpc subscribes via addEventListener, not onmessage).
  **Patch before workers spawn** — bound references to the original
  postMessage bypass a late prototype patch entirely.
- Patch `AudioContext.prototype.createBufferSource` to count scheduled TTS
  buffers (`player.writeFloat32` creates one per pcm chunk) — `sources===0`
  proves audio never reached the player.
- console hooks installed via browser_console work for console.error and
  `unhandledrejection`; multi-statement evals often return `undefined` — store
  results into `window.__vars` and read them back in the next call.

## Known behavioral quirks observed

- Replies dispatch `engine.speak()` and PCM streams back, but if the NEXT user
  utterance lands while synthesis is in flight, the new turn's
  `this.abort?.abort()` drops the pcm at the `ctrl.signal.aborted` guard before
  `writeFloat32` — under continuous fake-mic input this killed 100% of reply
  audio. For barge-in/audible tests, feed speech that PAUSES during agent
  replies (e.g. one utterance per file loop, long silence after).
- Phase text can stay "voice error" through successful turns; don't trust the
  stage label as the sole signal — transcript appends + worker traffic are the
  source of truth.
- Closing settings from inside an interview fires the "leave the interview?"
  back-guard (settings uses pushState; popstate hits useBlocker) — click "stay".
- `/dev/voice-harness` loads but "create session + connect" is inert on the
  static deploy (needs server REST) — expected, not a bug.
- The interview auto-ends at the scenario timer and navigates to
  `/finish/<id>`; report generation hits the same LLM path (same CORS/503
  exposure).
