# Stack runbook

Bun monorepo, no Docker required for dev. Two runtimes ship from the same
code: the `di` server (sidecar/desktop mode) and the static SPA
(client-only/browser mode, also what deploys to static hosts).

## Layout

| Path              | What                                                              |
| ----------------- | ----------------------------------------------------------------- |
| `apps/web`        | TanStack Start SPA -> builds to `apps/web/dist/client`            |
| `apps/server`     | `di`: Hono API + WS voice loop + SQLite store, entry `src/cli.ts` |
| `packages/shared` | `@di/shared` valibot contracts (the anti-corruption layer)        |
| `packages/evals`  | vitest evals + `mock-provider` (OpenAI-compatible, CORS-enabled)  |
| `tests/e2e`       | Playwright specs; prose source of truth in `specs/*.md`           |
| `tools/dscheck`   | nested env for the design-token linter (TS6; repo pins TS7)       |

## Services and ports

| Service                         | Port | Notes                                            |
| ------------------------------- | ---- | ------------------------------------------------ |
| `di` server                     | 3000 | `server.port`: SPA + `/v1/*` + voice WS + sqlite |
| mock provider                   | 9000 | `mise run dev:mock`, zero API keys needed        |
| parakeet STT (local real voice) | 9003 | via `scripts/local-voice-stack.sh`               |
| pocket-tts (local real voice)   | 9004 | behind the OpenAI-compatible shim :9005          |
| web dev server (vite)           | 5173 | `mise run dev` when iterating on the SPA alone   |

All providers (`llm`, `stt`, `tts`, `embeddings`) are OpenAI-compatible HTTP
endpoints in `config.yaml` — any compatible server works (hosted APIs,
Ollama, vLLM, the mock). `embeddings` is optional; without it document
uploads are off.

## Voice (browser mode)

Server mode voice runs the ws pipeline (server STT/TTS providers above).
Client-only/static mode defaults to on-device wasm engines behind a
one-time consent + ~50MB download: sherpa-onnx streaming zipformer (stt)
and KittenTTS nano (tts) in web workers, mic capture + vendored silero VAD
(`apps/web/public/vad/`) on the main thread. The manifest + sha256-pinned
files come from `VITE_VOICE_MODELS_BASE`/manifest.json (or the
`di.voice.models-base` localStorage override, e.g. a self-hosted mirror),
verified into CacheStorage (OPFS fallback). Models are never committed to
git. Decline / missing wasm+simd / engine boot failure all degrade to Web
Speech (`SpeechRecognition`/`speechSynthesis`); a BYO `/v1/audio/speech`
endpoint stays a TTS option. Pickers + cache controls live in Settings ->
voice.

## Config

`config.yaml` validated by `ConfigSchema` (`packages/shared/src/config.ts`),
env overrides `DI_` + `__` (`DI_LLM__MODEL=gpt-4o`). See
[config-reference.md](config-reference.md) for the full key table.

- `files.*` is optional: defaults land in the platform app-support dir
  (`~/Library/Application Support/di`, `%APPDATA%/di`, `$XDG_DATA_HOME/di` or
  `~/.local/share/di`).
- Zero-conf demo LLM in dev: `mise run dev:server:demo-llm` sources
  `scripts/dev-env-demo-llm.sh` (`DI_DEMO_LLM_*` -> `DI_LLM__*` overrides; the
  SPA's one-click "demo endpoint" fill reads `VITE_DEMO_LLM_*`). The shared
  managed endpoint URL lives in `DEMO_LLM_BASE_URL`
  (`apps/web/src/lib/demo-llm.ts`) pending the rate-limited VPS proxy.
- `DI_TEST_MODE=1` mounts `/v1/test/*` (ping/state/events/pipeline/smoke).

## Start order

1. Optional providers: `mise run dev:mock` (key-free) or
   `scripts/local-voice-stack.sh` (real local STT/TTS via process-compose).
2. `bun run apps/server/src/cli.ts --config config.yaml`
   (`--check` first to validate config + probe providers).
3. SPA is served by the server from `apps/web/dist/client` (`mise run build`
   once), or `mise run dev` for vite dev.
4. Client-only path needs no server at all: serve `apps/web/dist/client`
   statically — the health probe resolves to browser mode and BYO/demo LLM
   settings take over.

## Common tasks (mise.toml)

| Task                           | Purpose                                                               |
| ------------------------------ | --------------------------------------------------------------------- |
| `mise run dev`                 | vite dev server for the SPA                                           |
| `mise run dev:mock`            | mock OpenAI-compatible provider :9000                                 |
| `mise run dev:server:demo-llm` | server with the zero-conf demo LLM endpoint                           |
| `mise run build`               | build the SPA into `apps/web/dist/client`                             |
| `mise run test`                | vitest across shared/server/evals/web                                 |
| `mise run validate:quick`      | T1 gate: oxfmt/import-paths/agents-md + ast-grep + ratchets + dscheck |
| `mise run validate`            | T2 pre-push: T1 + affected typecheck/test via task-spooler            |
| `mise run validate:full`       | T3 milestone/CI: T2 + full repo + knip                                |
| `mise run e2e`                 | Playwright specs (needs a test-mode server, see e2e AGENTS.md)        |
| `mise run seed`                | seed a demo session over the API                                      |
| `mise run smoke`               | `/v1/test/smoke` behavioral probe                                     |
| `mise run release`             | per-OS release archives into `dist/releases/`                         |
| `mise run intl`                | locale key-parity check (advisory)                                    |

## Tests

- Unit: `mise run test` (vitest per package; bun runtime for shared/server/evals).
- E2E: start the server in test mode first — `DI_TEST_MODE=1 bun run apps/server/src/cli.ts --config config.example.yaml` — then `mise run e2e` (`DI_URL` to override the target).
- Evals: `mise run evals`.
