# voice latency assessment - gemini brainstorm vs the actual code

status: assessment, not a plan
date: 2026-09-28
source: attached gemini brainstorm (`voice-ai-streaming-client.md`) +
verification pass over `apps/web/src/lib/voice/`, `apps/web/src/lib/agent/`,
`packages/shared/src/interview-agent.ts`, and the open voice PRs
(#35 `devin/1790534885-voice-fixes`, #36 `devin/1790536405-voice-observability`).

product frame: the flagship path is browser-hosted app + wasm stt/tts + cloud
llm. server mode and builtin/cloud fallbacks are best-effort. every verdict
below is scored against that priority.

## top-level verdict

**wasm stt + wasm tts + cloud llm is viable as the flagship path on commodity
laptops, and the brainstorm's central diagnosis is right.** the pipeline's
latency is dominated by three things we control:

1. **endpointing silence tax** - vad-web defaults ship `redemptionMs: 1400`,
   so every user turn eats ~1.4s of dead air before the llm request even
   starts (`vad.ts` passes no thresholds, so defaults apply - see
   `node_modules/@ricky0123/vad-web` `defaultFrameProcessorOptions`). this is
   the single largest per-turn latency term, bigger than anything downstream.
2. **tts time-to-first-audio** - on main, `TtsEngine.speak()` returns one
   `Promise<Float32Array>` for a whole sentence
   (`apps/web/src/lib/voice/engines.ts:41-45`), the kitten worker synthesizes
   the sentence in a single `session.run` and posts one pcm message
   (`apps/web/src/lib/voice/kitten/kitten-worker.ts:71-85`), and the engine
   collects everything before `PcmPlayer` ever sees a byte
   (`wasm-engines.ts:127-138`). pr #36 adds a kkrpc async-iterable inside the
   worker boundary but still concatenates before resolving, so the gap
   survives #36.
3. **barge-in is effectively disabled once #35 lands** - the half-duplex
   echo gate (`playbackGated` + `echoGateUntil` + `pendingSpeaks` on the #35
   branch) drops all mic-derived speech evidence while agent audio is queued
   or playing. it fixes real self-interruption, but the flagship loses
   barge-in entirely: interrupts stay reachable only via mute/typed input.

download cost is real but bounded: ~26mb zipformer-small int8 + ~24mb
kittentts nano + ~15mb sherpa wasm (`stt-worker.ts:8-14` assets) + ~14mb
vendored ort wasm (`apps/web/public/vad/`) ≈ 80mb one-time, sha-verified and
cache-stored (`models.ts:34-68`). single-threaded ort wasm for tts is the
throughput risk - see "what to measure first".

## 1. streaming tts playback

- **doc proposes**: the engine boundary collects all chunks into one
  `Float32Array` before `PcmPlayer`; move to an
  `AsyncIterable<Float32Array>` engine contract plus two-tier chunking
  (first-chunk early flush at 4-6 words/first punctuation, then sentence
  boundaries).
- **what's true today**: `TtsEngine.speak()` returns
  `Promise<Float32Array>` (`engines.ts:43`). `PcmPlayer.writeFloat32` already
  supports incremental enqueue with a scheduled playhead - `enqueue()` /
  `scheduleNext()` chain `AudioBufferSourceNode`s back-to-back with no
  buffering requirement (`pcm-player.ts:77-116`). the collect-everything
  claim is correct on main (`wasm-engines.ts:127-138`: one `pending` entry
  resolves with the worker's single `pcm` message). on the #36 branch the
  kitten api yields ~340ms chunks (`CHUNK_SAMPLES = 8_192` at 24k in
  `kitten-api.ts`) via a remote async iterable, but `WasmTts.speak()` still
  loops the iterator into a `chunks[]` array and concatenates - the driver
  still writes one buffer per sentence.
- **verdict: adopt**, and it is the highest-leverage change in the doc.
  sentence-level streaming is the real win, not sub-sentence chunking:
  kittentts phonemizes then runs one `session.run` per `speak()` call
  (`kitten-worker.ts:60-85`), so the unit of synthesis is a sentence
  regardless. the fix that matters is _plumbing_, not _chunking_:
  - after #36: expose the remote async iterable through the `TtsEngine` seam
    (e.g. `speakStream(sentence): AsyncIterable<Float32Array>`) and have
    `runAgentTurn`'s `speak` consume chunks into `player.writeFloat32` as
    they arrive (`browser-driver.ts:391-428`). ~0.5-1 session.
  - two-tier _text_ chunking (flush at first punctuation before a full
    sentence is in) is worth a smaller experiment: `cutSentences`
    (`interview-agent.ts:248-266`) only emits on terminal punctuation with
    `minChars = 24`, so first audio waits for a complete sentence of tokens.
    a "first segment" fast-path (first `,`/`;`/`:` or ~6 words) shaves
    100-300ms of perceived ttfa at the cost of one extra phonemize+run call.
    adapt, not adopt: keep the sentence cadence, add a first-flush only.
- **effort**: ~1 session including the #36 dependency.

## 2. client-side llm abort

- **doc claims**: barge-in does not abort the sse stream; `signal?:
AbortSignal` exists but is not wired to stream teardown.
- **what's true today**: the claim is stale. the abort path is wired
  end-to-end on main: `interrupt()` calls `this.abort?.abort()`
  (`browser-driver.ts:525-528`), the per-turn controller is combined with a
  turn timeout via `AbortSignal.any` (`browser-driver.ts:456`), passed as
  `opts.signal` to `agent.respond` (`client-agent.ts:311` →
  `streamText({abortSignal})`), which reaches the provider's `doStream` and
  lands on `fetch`'s `signal` (`openai-compatible-provider.ts:202`) with a
  `cancel()` that calls `reader.cancel()` (`openai-compatible-provider.ts:315-317`).
- **the real gap**: not the llm stream - the _tts compute_. on main,
  `WasmTts.speak()` has no cancellation; an aborted turn leaves
  `engine.speak(sentence)` synthesizing in the worker (the promise resolves
  into a dropped `writeFloat32`, guarded by `ctrl.signal.aborted` at
  `browser-driver.ts:409-410`). sentence speaks queued by
  `void speak(s)` (`browser-driver.ts:462`) keep burning wasm cpu after
  barge-in. #36 adds `cancelPending()` (remote iterator `return()` + worker
  `clear()`) - that is the right fix and lands with the streaming work in
  §1.
- **verdict: skip** the proposed `currentTurnAbortController` refactor
  (already equivalent), **adopt** cancellation propagation into the wasm tts
  engine (bundled with §1).
- **effort**: ~0.25 session on top of §1.

## 3. adaptive echo gate vs half-duplex

- **doc proposes**: replace the hard gate with dual-threshold vad
  (p > 0.88 sustained ~2 frames during playback) + an rms floor.
- **what's true today**: main has no gate - `noteSpeech()` on vad
  speech-start arms a 300ms `BARGE_IN_GRACE_MS` timer then `interrupt()`
  (`browser-driver.ts:113`, `268-276`), which is why speaker bleed
  self-interrupts tts. the #35 branch adds the hard gate. our silero path
  surfaces per-frame probabilities: vad-web 0.0.30's `MicVAD` accepts an
  `onFrameProcessed(probabilities, frame)` callback and we feed it via
  `processFrame` already (`vad.ts:55-98`); frame cadence is ~96ms
  (`FRAME_SAMPLES = 1536`, `vad.ts:38`). capture already computes per-frame
  rms for the orb (`capture.ts:164-175`, `onLevel`), so both signals the doc
  needs exist without new plumbing.
- **verdict: adapt.** the shape is right, the thresholds are not verifiable
  from the armchair: whether speaker echo through chrome's aec scores < 0.88
  is device- and volume-dependent, and vad-web's _default_ positive
  threshold is 0.3 (`defaultFrameProcessorOptions`), which tells you the
  model's confidence scale is already compressed. implement as a _parallel_
  adaptive rule: keep the gate, but during the gated window count
  consecutive `probs.isSpeech > T_echo` frames with rms above ambient and
  fire `interrupt()` on N consecutive hits. gate the gate, don't delete it.
  measure first (see below); the parameters belong in `voice-health`-visible
  constants, not tuned blind.
- **effort**: ~1 session incl. device testing; depends on #36 for the
  measurement harness.

## 4. speculative fillers during tool calls

- **doc proposes**: synthesize a canned acknowledgment after ~250ms when a
  tool call runs.
- **what's true today**: absent. `voiceToolsFor` tools execute inside
  `streamText`'s step loop (`client-agent.ts:298-313`); nothing speaks
  between the tool call and the next text delta.
- **verdict: adapt, low priority.** real but small: the tool set
  (`read_editor`, `read_whiteboard`, `update_question`,
  `interview-agent.ts:118-180`) executes against in-process stores and is
  fast (<50ms typical), so the 500-2000ms silence the doc targets barely
  exists in our tool surface. if kept, wire it where the gap actually is:
  a filler only when a step boundary _plus_ a slow llm hop is detected -
  i.e. on `streamText`'s second-step latency, not on tool dispatch. a
  static filler list is fine; no need for a second llm call.
- **effort**: ~0.5 session. recommend deferring until §1 lands so fillers
  ride the same streaming path.

## 5. esnext features

- **doc proposes**: `using`/`DisposableStack` for turn-scope cancellation,
  `AbortSignal.any()` for unified barge-in, `Promise.withResolvers()`
  push→pull queue, async-generator token→phrase chunker, iterator helpers.
- **what's true today**: `AbortSignal.any` and `AbortSignal.timeout` are
  already in use (`browser-driver.ts:416`, `:456`; `report.ts:39`).
  `Promise.withResolvers` and `using`/`DisposableStack` do not appear.
  toolchain: typescript `^7.0.2` (root `package.json`), target `ES2023`
  (`tsconfig.base.json`), vite `^8` with default build target
  (baseline-widely-available) - no `build.target` override in
  `vite.config.ts`.
- **verdict: adopt selectively.**
  - `AbortSignal.any`/`timeout`: already the pattern; keep.
  - `Promise.withResolvers`: adopt when §1 needs a push→pull queue (worker
    chunk callbacks → async iterable). trivial and baseline since 2024.
  - async generators: adopt for the token→sentence chunker; kkrpc already
    models tts as a remote async iterable on #36.
  - `using`/`DisposableStack`: **adapt, mostly skip.** ts 7 supports the
    syntax, but `Symbol.dispose` is only baseline-newly-available (chrome
    133, safari 18.4, firefox 141); at target ES2023 ts downlevels `using`
    but still needs the symbol at runtime, so this adds a polyfill or drops
    older browsers for marginal try/finally savings. revisit if the turn
    scope grows more resources.
  - iterator helpers (sync): fine where they appear; async iterator helpers
    are not baseline, skip.
- **effort**: negligible where adopted; the polyfill decision is the only
  real cost.

## 6. semantic endpointing

- **doc proposes**: interim-transcript-aware endpointing - fast cutoff on
  terminal punctuation (~150-200ms), long cutoff on conjunctions.
- **what's true today**: endpointing is pure vad-web defaults - silero
  frames (`vad.ts`), `redemptionMs` 1400ms of silence before `onSpeechEnd`
  fires `stt.flush()` (`browser-driver.ts:253-254`), with sherpa's own
  `isEndpoint` as a backstop (`stt-worker.ts:142`). interim partials do
  exist - the sherpa worker posts `{type:"partial"}` on every decode that
  moves (`stt-worker.ts:108-117`) and `WasmStt` forwards them to
  `SttEngineCallbacks.onInterim` (`wasm-engines.ts:196-199`) - but the
  browser driver discards the text: `onInterim: () => this.noteSpeech()`
  (`browser-driver.ts:237`). the fsm (`machine.ts`) has no endpointing
  concept beyond `SPEECH_END`.
- **verdict: adopt, this is the top-1 real latency lever.** the interim text
  is already delivered to the driver; the missing piece is using it. the
  pragmatic version that fits our structure: shorten `redemptionMs` (the
  1400ms default is the tax), and on `onSpeechEnd` hold one extra
  continuation-grace (~600ms) when the latest interim looks syntactically
  open (no terminal punctuation / trailing conjunction). that needs no vad
  internals - just `createVadGate` options + keeping `lastInterim` in the
  driver.
- **effort**: ~1 session, mostly tuning + e2e fixtures.

## 7. prompt caching + spoken-syntax prompt rule

- **doc proposes**: pin static rules at the top of the system prompt;
  explicit no-markdown/spoken-prose directive.
- **what's true today**: `buildPrompt` (`interview-agent.ts:72-101`) already
  leads with static lines, then appends dynamic context (mode/title/prompt/
  documents/plan/currentQuestion) and a trailing static rule. the structure
  is fine for prefix caching _within a session_; the only per-turn churn is
  `currentQuestion`/`hints` inside the same system message - provider-side
  prefix caching still hits the head. the real gap: **no spoken-syntax
  rule at all** - "Speak naturally... conversational" is the only style
  directive. kittentts's phonemizer passes a fixed punctuation set through
  and sends everything else to espeak (`kitten/phonemize.ts:9-46`);
  characters outside the 178-symbol table are silently dropped
  (`kitten/text-cleaner.ts:24-37`), so markdown asterisks, urls and symbols
  don't crash it - they produce garbage phonemes or silence.
- **verdict: adopt the directive, skip the restructuring.** add a
  spoken-prose rule (no markdown, no lists, spell out symbols/numbers) to
  `buildPrompt`'s static head. do not reorder for caching - the current
  layout is already prefix-friendly.
- **effort**: <0.25 session.

## 8. ws multiplexing llm over the voice socket

- **doc proposes**: tunnel llm rpc over the persistent voice ws.
- **what's true today**: in browser mode there is no voice ws - that socket
  only exists in `ServerVoiceDriver` (`server-driver.ts`), where the llm is
  already server-side. in the flagship browser path the llm call is a direct
  fetch to an openai-compatible endpoint (`openai-compatible-provider.ts`) -
  or the demo gateway (`api.illo.fyi`). a ws mux would add a server hop to
  the path we're trying to keep client-side.
- **verdict: skip for the flagship.** it only helps a hypothetical
  server-mediated llm path, which is the non-flagship topology. connection
  reuse on the openai-compatible fetch (keep-alive) covers most of the
  handshake cost anyway.
- **effort**: n/a.

## 9. perceived latency (earcon, interim echo, orb thinking)

- **doc proposes**: earcon on speech-end, interim transcript echo in ui,
  orb "thinking" state.
- **what's true today**: the orb already maps `agent_speaking`/`listening`/
  `thinking` to vendor orb states (`voice-orb.tsx:62-69`) - but in
  client-only mode it's a css pulse, not webgl (by design). the status chip
  exists (`phaseKeys` in `interview.$id.tsx:78-84`), the live waveform is
  above the composer (`interview.$id.tsx:394-409`), and the
  `user_speaking → thinking` transition already fires at vad speech-end.
- **the gap**: nothing acknowledges the _user's_ voice at the moment of
  capture - `thinking` only enters after the full silence window, so the
  perceived dead air is exactly the endpointing tax from §6 plus whatever
  llm/tts latency follows. interim transcript echo is unimplemented: the
  sherpa partials exist (`stt-worker.ts:108-117`) but are dropped at the
  driver (`browser-driver.ts:237`) and never reach a store or the
  `TranscriptPane`.
- **verdict: adopt, cheap and pairs with §6.** surfacing `onInterim` text
  into the stage caption (or a ghost line in the transcript) plus a short
  earcon/`user_speaking → thinking` visual at speech-end covers most of the
  perceived-latency budget while §1+§6 remove the real one.
- **effort**: ~0.5-1 session.

## what to measure first

before tuning any of this, land the observability base - pr #36 already
ships the harness: a `$voiceHealth` ring of `engine.boot`, `worker.error`,
`stt.firstPartial`, `stt.flush`, `tts.speak`, `playback.gap`,
`playback.drained`, `playback.stop` events (`health.ts` on the #36 branch),
plus `TurnMetrics` (`packages/shared/src/voice.ts:90-102`) carrying
`vad_ms`, `llm_ttft_ms`, `first_audio_ms`, `total_ms`. measure, in order:

1. **endpointing tax**: silence duration between last speech frame and
   `stt.flush` - confirms the 1400ms redemption window is the dominant
   term (expected).
2. **tts throughput vs realtime**: `tts.speak` ms per sentence and
   `playback.gap` underrun events - the single-threaded ort wasm question
   (`kitten-worker.ts:52-55` pins `numThreads = 1` because the app is not
   cross-origin-isolated; a threaded ort build would need coi headers we
   don't currently emit). if kittentts nano can't stay ahead of playback on
   a mid-range laptop, streaming the chunks (§1) buys nothing and the
   answer is a smaller/faster model or the endpoint path.
3. **echo false-positive rate**: during playback, vad `isSpeech` probs and
   rms on captured frames - the only way to pick `T_echo` for §3.

the `/dev/voice-harness` route already drives the server-driver loop with
synthetic pcm utterances - extend the same idea to the browser driver for
repeatable turn-timing fixtures.

## phased recommendation

### now (unblocks everything)

- land #36 (kkrpc worker streaming + `$voiceHealth`) - it is the
  measurement and the plumbing §1 needs.
- land #35's echo gate _as the interim fix_ (half-duplex > self-interrupt
  loops), knowing §3 replaces it.
- add the spoken-syntax line to `buildPrompt` (§7): one line, real tts
  quality gain.

### next (the latency program)

1. **streaming tts to `PcmPlayer`** (§1): `speakStream` through the engine
   seam, chunk-at-a-time `writeFloat32`, `cancelPending` on barge-in (§2).
2. **endpointing** (§6): `redemptionMs` down from 1400, interim-text-aware
   continuation grace; also enables the speech-end ui cue (§9).
3. **adaptive echo gate** (§3): restore barge-in with measured thresholds.

### later (polish, after the above are measured)

- first-segment fast flush in `cutSentences` (§1 second tier).
- interim transcript echo in the stage caption (§9).
- speculative fillers only if tool/step gaps prove out in metrics (§4).
- `Promise.withResolvers` queue where the push→pull seam needs it (§5);
  `using`/`DisposableStack` when `Symbol.dispose` coverage is boring.
- ws llm multiplexing: only if a server-mediated llm gateway ever becomes
  the flagship (§8) - currently counter-productive.

### effort summary

| item                              | verdict     | effort (sessions) | depends on |
| --------------------------------- | ----------- | ----------------- | ---------- |
| streaming tts → pcmplayer         | adopt       | ~1                | #36        |
| llm abort (already wired)         | skip        | -                 | -          |
| wasm tts cancel on barge-in       | adopt       | ~0.25             | #36        |
| adaptive echo gate                | adapt       | ~1                | #36, #35   |
| speculative fillers               | adapt       | ~0.5              | §1         |
| `AbortSignal.any`/`withResolvers` | adopt       | ~0                | -          |
| `using`/`DisposableStack`         | mostly skip | -                 | polyfill   |
| semantic endpointing              | adopt       | ~1                | #36        |
| spoken-syntax prompt rule         | adopt       | <0.25             | -          |
| ws llm mux                        | skip        | -                 | -          |
| earcon + interim echo ui          | adopt       | ~0.5-1            | §6         |

## top risks for the flagship claim

- **single-threaded ort wasm tts throughput.** if `tts.speak` ms exceeds
  audio duration on commodity hardware, sentence streaming can't hide it
  and the choice is a threaded ort build (requires cross-origin isolation
  headers, which the spa host may not send - `kitten-worker.ts:52-55`
  documents why we currently avoid it) or falling back to endpoint tts.
- **endpointing is a tuning problem, not a code problem.** the 1400ms
  vad-web default was chosen for dictation; conversational turns want
  ~250-400ms. wrong values trade dead air for cut-off mid-sentence turns -
  the continuation-grace design in §6 is the hedge.
- **aec quality varies by device.** chrome's `echoCancellation: true`
  (`capture.ts:117-124`) plus a raised vad threshold will still
  false-trigger on some speaker+mic combos; the adaptive gate must be
  measured per-device, not assumed. this is the flagship's biggest
  product-level uncertainty, not the model download.
