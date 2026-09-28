# configurable constants audit

date: 2026-09-28
scope: apps/web, apps/server, packages/shared. `apps/web/src/lib/voice/` internals are
excluded on purpose: a parallel branch is rewiring that subtree (browser-driver,
server-driver, wasm-engines, health sampling), so its constants are inventoried here
for completeness but classified "deferred to voice branch" rather than assigned.

## rule of thumb

- deployment/environment facts (ports, endpoints, api bases, demo flags) → build-time env.
- ops tuning an operator or self-hoster would reach for (timeouts, retry budgets,
  upload caps, retrieval depth, token limits) → server config key (every yaml key gets
  a `DI_<SECTION>__<KEY>` env override for free) or `VITE_*` env for web-bundle builds.
- user-facing preferences (engine picks, themes, language, device ids) → runtime store
  (`persistentAtom` under `di.*` localStorage keys). already implemented; nothing to add.
- internal invariants (wire protocol, layout constants, algorithm budgets, prompt text)
  → stay hardcoded.

## the wrinkle that shapes every web verdict

the shipped product bundles the spa inside the `di` binary (`apps/web/dist/client`
served by the same origin). a self-hoster cannot change `VITE_*` vars without
rebuilding: those are packager-time knobs, not end-user knobs. when an end user
might need the override too, the codebase already has the dual pattern —
`VITE_VOICE_MODELS_BASE` as the build-time default plus `di.voice.models-base` in
localStorage as the runtime override (`apps/web/src/lib/voice/models.ts:22-28`).

## existing precedents (follow these)

| mechanism | where | what it does |
| --- | --- | --- |
| `DI_<SECTION>__<KEY>` | `apps/server/src/config/load.ts` | env override for every yaml key; digits coerce to numbers |
| `VITE_DI_API_BASE` | `apps/web/src/lib/runtime.ts`, `lib/api.ts`, `lib/voice/index.ts` | cross-origin api base for dev builds |
| `VITE_DEMO_LLM_*` | `apps/web/src/lib/demo-llm.ts` (+`DI_DEMO_LLM_*` dev fill) | build-injected zero-conf demo endpoint |
| `VITE_VOICE_DEFAULT` | `apps/web/src/lib/voice/index.ts` | pins the voice driver, beats the health probe |
| `VITE_VOICE_MODELS_BASE` + `di.voice.models-base` | `apps/web/src/lib/voice/models.ts` | dual build/runtime override for the model manifest root |
| `VITE_PUBLIC_SITE` | `apps/web/src/components/landing-page.tsx` | landing-page variant flag |
| `di.*` persistentAtoms | `apps/web/src/stores/*`, `lib/runtime.ts` | runtime user prefs (runtime-mode, provider-profile, mic, editor, language, voice engines) |
| `DI_TEST_MODE`, `DI_URL` | `apps/server/src/cli.ts`, `tests/e2e` | standalone env vars outside the yaml schema |

## inventory + verdicts, ranked by operator value

### rank 1 — clear wins (implement now)

| constant | file:line | current | blast radius | verdict |
| --- | --- | --- | --- | --- |
| timeout budgets (ws open, model load/download, tts sentence, llm turn, llm smoke, tts test) | `apps/web/src/lib/timeouts.ts:6-18` | 10s / 10min / 10min / 15s / 90s / 90s / 5s | every voice + model path in the spa; the only central budget file | build-time `VITE_TIMEOUT_*_MS` per constant, hardcoded fallback. slow-network packagers are the real audience; end-user runtime override can follow the models-base dual pattern later if asked |
| document caps `maxFiles`, `maxTotalBytes` | `packages/shared/src/document.ts:29-32` | 10 files / 20 MB | enforced in `rag/ingest.ts` (413s) and pre-checked in `setup.tsx` | server config `documents.max_files` / `documents.max_total_bytes` (env: `DI_DOCUMENTS__*`). web keeps the shared defaults for pre-validation |
| duplicated cap literals | `apps/web/src/routes/{-$locale}/setup.tsx:47-48` | 10 / 20 MB, duplicated instead of importing `DOCUMENT_CAPS` | drift risk: web pre-check disagrees with server enforcement | not a knob — dedupe: import `DOCUMENT_CAPS` from `@di/shared` |
| duplicated report timeout | `apps/web/src/lib/report.ts:34` | literal `90_000`, same as `LLM_TURN_TIMEOUT_MS` | client-only report generation | not a knob — dedupe to the timeouts.ts constant so the env override covers it |
| context retrieval top-k | `apps/server/src/api/routes.ts:345,361` | `8` chunks, two literals | `/v1/sessions/:id/context` grounding quality vs prompt size | server config `documents.context_top_k` (env: `DI_DOCUMENTS__CONTEXT_TOP_K`) |
| rag chunking | `packages/shared/src/document.ts:34-35`, used by `apps/server/src/rag/parse.ts` | `CHUNK_SIZE` 1000, `CHUNK_OVERLAP` 150 | ingest-time only; affects embedding quality for existing docs on re-ingest | server config `documents.chunk_size` / `documents.chunk_overlap` |
| anthropic `max_tokens` | `apps/server/src/voice/llm.ts:157` | 1024 (anthropic path only; openai path sends none) | truncates agent replies on anthropic flavor | server config `llm.max_tokens` (env: `DI_LLM__MAX_TOKENS`) |
| pending-turn retry policy | `apps/web/src/lib/api.ts:25-26` | 3 tries, 1s base backoff | offline/flaky-network resilience of typed turns | build-time `VITE_TURN_POST_RETRIES` / `VITE_TURN_POST_RETRY_BASE_MS` |
| server health probe timeout | `apps/web/src/lib/runtime.ts:85` | 2_000 ms literal | driver selection / runtime fallback latency on slow lans | build-time `VITE_SERVER_PROBE_TIMEOUT_MS` |
| `di --check` provider probe timeout | `apps/server/src/check/probe.ts:24,37` | 3_000 ms, two literals | cli diagnostics on slow providers | server config `check.timeout_ms` (env: `DI_CHECK__TIMEOUT_MS`) |
| voice kickoff delay | `packages/shared/src/interview-agent.ts:70`, consumed `apps/server/src/voice/loop.ts:129` | 5_000 ms (server default; browser driver reads it inside lib/voice) | pacing of the agent's opening question | server config `voice.kickoff_ms` (env: `DI_VOICE__KICKOFF_MS`); shared constant stays as the fallback for both sides |
| tool output truncation | `apps/server/src/voice/loop.ts:77,667` | `MAX_TOOL_OUTPUT` 4000 chars | how much editor/whiteboard content reaches the llm | server config `voice.max_tool_output` (env: `DI_VOICE__MAX_TOOL_OUTPUT`) |
| browser llm default model | `apps/web/src/lib/agent/browser-provider.ts:46` | `onnx-community/Qwen3-0.6B-ONNX` | shipped default for the transformers.js engine; users can already pick another id in settings | build-time `VITE_TRANSFORMERS_MODEL_ID` |

### rank 2 — reasonable but not worth it yet

| constant | file:line | current | blast radius | verdict |
| --- | --- | --- | --- | --- |
| bun.serve `idleTimeout` | `apps/server/src/api/app.ts:170` | 255 s — already bun's maximum | llm-backed routes | stay hardcoded; nothing to gain, document only |
| report parse retries | `apps/server/src/report/generate.ts:26` | 2 attempts | report generation robustness | stay hardcoded; a retry loop bound is an algorithm invariant |
| agent hop budget / context window | `apps/web/src/lib/agent/client-agent.ts:142-147` | `MAX_HOPS` 4, `WINDOW_MESSAGES` 16, `COMPACT_BATCH` 4 | client-agent loop behavior; comment says MAX_HOPS mirrors the server's loop budget | stay hardcoded for now; if tuned later it belongs in shared so both agents agree |
| live-stt test duration | `apps/web/src/lib/settings-tests.ts:111`, `settings-drafts.tsx`, `settings-voice-pane.tsx` | 15_000 ms (+500 ms poll, +3 s browser-stt probe) | settings test-voice row only | stay hardcoded; a settings-pane affordance, not ops |
| slow-load hints | `interview.$id.tsx:226`, `report.$id.tsx:69` | 15_000 ms | ui hint timing only | stay hardcoded; cosmetic |
| tool-state push debounce | `interview.$id.tsx:297` | 1_000 ms | doc sync to server | stay hardcoded; ui coalescing |
| whiteboard snapshot cap | `apps/web/src/lib/whiteboard-store.ts:25` | 8 KB | agent's read_whiteboard rendering budget | stay hardcoded; paired with server MAX_TOOL_OUTPUT, revisit together if ever |
| whiteboard panel debounce | `apps/web/src/components/whiteboard-panel.tsx:8` | 400 ms | save coalescing | stay hardcoded; ui coalescing |
| model-list fetch debounce, profile persist debounce | `settings-drafts.tsx:125,183` | 600 ms each | settings pane only | stay hardcoded |
| device-memory heuristic | `apps/web/src/lib/agent/browser-provider.ts:150` | `deviceMemory <= 4` | wasm-vs-webgpu engine pick | stay hardcoded; heuristic |
| countdown tick, wrap threshold, focus delay | `interview.$id.tsx:68,313,347` | 1 s, 120 s, 50 ms | timer ui | stay hardcoded; internal invariants |
| `MAX_VISIBLE_TABS` | `tool-dock.tsx:15` | 4 | dock layout | stay hardcoded; layout constant |

### rank 3 — stay hardcoded (internal invariants)

| constant | file:line | why |
| --- | --- | --- |
| `CAPTURE_SAMPLE_RATE` 16k, `TTS_SAMPLE_RATE` 24k, `AUDIO_HEADER_BYTES` | `packages/shared/src/voice.ts:19,141-142` | wire protocol between web and server; changing one side breaks the other |
| `TTS_CHUNK_BYTES` | `apps/server/src/voice/loop.ts:76` | derived from TTS_SAMPLE_RATE; 20 ms framing is a protocol detail |
| stt wav sample rate | `apps/server/src/voice/stt/whisper-stt.ts:99` | matches CAPTURE_SAMPLE_RATE contract |
| `KICKOFF_UTTERANCE`, `PARSE_RETRY_HINT`, prompts | `interview-agent.ts`, `report/generate.ts` | prompt text, not tunables |
| `VOICE_WS_PATH_RE`, pipeline stage names | `voice/ws.ts`, `api/test-mode.ts` | contract identifiers |
| `LOCALES`, `RTL_LOCALES` | `apps/web/src/stores/session.ts` | shipped-locale manifest, not runtime data |
| `ACCEPTED` extensions | `setup.tsx:49` | mirrors `kindForName` server-side; contract, not a cap |
| redact slice lengths | `lib/runtime.ts:41-45` | cosmetic masking |
| orb/debounce/vendor props | `components/vendor/*`, `orb.tsx` | vendored ui internals |
| dev voice harness constants | `dev.voice-harness.tsx:22-24` | dev-only route |
| `di.*` storage keys, legacy profile migration | `shared/providers.ts`, `lib/runtime.ts` | persisted-key compatibility, never config |
| mock provider port 9000, `DI_URL` default | `packages/evals`, `tests/e2e` | already env/`--port`-driven where it matters |

### deferred to the voice branch (inventoried, not assigned)

`apps/web/src/lib/voice/` internals — `server-driver.ts` reconnect policy (5 tries,
1 s base, 15 s cap), `wasm-engines.ts` `RPC_TIMEOUT_MS` 120 s, `browser-driver.ts`
barge-in/echo/confidence thresholds, `levels.ts` `RELEASE_MS` 220, `health.ts`
`CAP` 300, `kitten-api.ts` chunking. the parallel voice branch owns these; any
configurability there lands with that work.

## implementation plan (pr 2)

server side gets optional config sections — env overrides come free via the existing
`DI_*__*` mechanism, so no `Bun.env` reads are needed:

```yaml
llm:     { ..., max_tokens: 1024 }           # optional
voice:   { kickoff_ms: 5000, max_tool_output: 4000 }   # optional section
check:   { timeout_ms: 3000 }                # optional section
documents: { max_files: 10, max_total_bytes: 20971520,
             chunk_size: 1000, chunk_overlap: 150, context_top_k: 8 }  # optional
```

web side gets `lib/env.ts` (`envNum`/`envStr`/`envBool` over `import.meta.env.VITE_*`
with fallback) wired into `timeouts.ts`, `api.ts` retry policy, `runtime.ts` probe
timeout, `browser-provider.ts` default model. `report.ts` and `setup.tsx` dedupe to
the shared/timeouts constants. every new var documented in `.env.example` and
`.agents/docs/config-reference.md`; defaults identical when unset.
