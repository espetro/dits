# apps/server/AGENTS.md

Hono API on Bun, storage in bun:sqlite via Kysely. `src/cli.ts` is the entry
(`--config`, `--check`). `src/api/routes.ts` defines `/v1/*`;
`src/api/test-mode.ts` mounts `/v1/test/*` when `DI_TEST_MODE=1`. Serves the
built SPA from `apps/web/dist/client` if present (bare API on `server.port` if
that directory is missing). Generates `/v1/openapi.json` in `src/api/app.ts`.

## Voice pipeline (`src/voice/`)

In-process: WS handler (`ws.ts`), per-connection `VoiceLoop` (`loop.ts`), and
adapter implementations (`stt/whisper-stt.ts`, `tts/pocket-tts.ts`, `llm.ts`)
all speaking OpenAI-compatible HTTP. `VoiceLoop` takes injected STT/TTS/LLM
ports; tests stub them.

- Transport is streaming WS frames, but recognition is utterance-buffered (client VAD delimits; parakeet has no streaming endpoint).
- TTS responses are WAV; the server decodes and resamples to 24k PCM16 regardless of provider sample rate.

## Test mode driving recipe

The fastest way to exercise the whole app without a browser:

```sh
bun run packages/evals/mock-provider/main.ts --port 9000 &         # mock provider, no keys
DI_TEST_MODE=1 bun run apps/server/src/cli.ts --config config.yaml
bun run apps/server/src/cli.ts --config config.yaml --check    # validate config + probe providers
```

1. `curl -s $DI_URL/v1/test/ping` must return `{"testMode":true}`; if it 404s, test mode is off.
2. `POST /v1/sessions` with `{title, mode, duration_min}` (duration 5..120, mode `interview|coach`). Response is 201 with a uuid `id`.
3. Voice over WS: open `GET /v1/sessions/:id/voice` as a WebSocket, send binary frames (4-byte big-endian seq + PCM16LE mono 16k), then `{t:"utterance_end"}`; expect `user_transcript` → `agent_transcript` → `agent_speaking on` → `tts` chunks (binary framing + b64 JSON) → `agent_speaking off`. Control messages: `{t:"mute",muted}`, `{t:"interrupt"}` (b64 `{t:"audio",seq,pcm}` frames accepted as fallback). Contracts: `packages/shared/src/voice.ts`.
4. Text turns: `POST /v1/sessions/:id/turns` with `{id: uuid, seq, speaker: user|agent, text, created_at: ISO, source: voice|text}`.
5. Assert via `GET /v1/test/state` (sessions + reports) and `GET /v1/test/events?session_id=...` (voice loop lifecycle + agent turns) or `GET /v1/test/pipeline/:id` (ordered STT/LLM/TTS stage view).
6. Round-trip checks: `PUT`/`GET /v1/sessions/:id/tools` (per-tool content map, `Record<toolId, state>` — the voice loop's `read_<id>`/`update_<id>` tools resolve against it) and `POST`/`GET /v1/sessions/:id/report`.

Full-stack test with real voice (no cloud STT/TTS): `scripts/local-voice-stack.sh`
starts parakeet STT (:9003), pocket-tts (:9004) behind an OpenAI-compatible
shim (:9005). Then `source scripts/dev-env.sh` (Bifrost LLM via keychain key,
never on disk) and start the server. See `scripts/pocket-shim.ts` for why the
shim exists.

`mise run e2e` does not start a server — start one in test mode first, or
point `DI_URL` at it. `mise run smoke` hits `$DI_URL/v1/test/smoke`
(test-mode only).
