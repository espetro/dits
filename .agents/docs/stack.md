# Stack runbook (native, non-Docker)

## Services and ports

| Service              | Port  | Notes                   |
| -------------------- | ----- | ----------------------- |
| web (TanStack Start) | 3000  | served by the di server |
| lightrag             | 9621  | RAG / grounding         |
| whisper / speaches   | 8001  | STT                     |
| kokoro               | 8890  | TTS                     |
| Ollama               | 11434 | local LLM               |

## Env files

- `apps/agent/.env`
- `apps/web/.env.local`

Copy from teammates / templates if missing; never commit real values.

## Config

- `apps/agent/config/ui.toml` - UI-facing config for **languages, voices,
  and difficulties** (`[languages] offered / stt_supported`, per-language
  `[voices.<lang>]` with default + options, `[difficulties]` levels + clamps).
  The setup screen reads its voice dropdown, language chips, and difficulty
  options from here via the agent's `GET /api/config/ui` (proxied by the web
  route `apps/web/app/api/config/ui/route.ts`). The loader is
  `src/deepinterview_agent/core/ui_config.py`; set `UI_CONFIG_PATH` to
  override the file location (useful for tests and local experiments). The
  live interviewer's difficulty clamp (easy 2, medium 3, hard 4) also reads
  this file. When you add a language or voice, update this file, and update
  `.agents/docs/screens/setup.md` in the same commit.

## Start order

1. Infra services (lightrag :9621, whisper/speaches :8001,
   kokoro :8890, Ollama :11434) - start these first; the app
   depends on them.
2. Agent API:
   ```bash
   uv --directory apps/agent sync
   # then run the agent API (serves :8000) with env from apps/agent/.env
   ```
3. Web app (turbo dev):
   ```bash
   pnpm dev
   ```

`pnpm dev` runs via turbo; web listens on :3000 and proxies agent calls to
:8000.

## Tests

Agent (pytest):

```bash
cd apps/agent && uv run pytest -q
```

Web (vitest):

```bash
cd apps/web && vitest run
```

## Client-only runtime: latency notes

See ADR-0003 for the full design. In `local-server` mode, LLM/STT/TTS calls
round-trip through the `di` server to whatever backend it's configured with
(often same-host or same-LAN). In `client-only` mode every call — the
interview loop's `streamText`, TTS synthesis, and report scoring's
`generateObject` — goes straight from the browser to the user's configured
BYO `baseUrl`, with no local hop in between:

- **interview turns**: same shape as `local-server` mode's LLM latency, minus
  one internal hop; SpeechRecognition (Web Speech API) replaces server-side
  Whisper STT and is typically faster for short utterances but is
  network-dependent in Chrome regardless of `baseUrl`.
- **TTS**: only used when a `ttsModel` is configured; otherwise the browser's
  `speechSynthesis` (instant, on-device, lower quality) is the fallback — see
  `BrowserVoiceDriver.useTtsEndpoint`.
- **report generation**: one `generateObject` call scoring the full
  transcript at once (no streaming), so its latency scales with transcript
  length and the provider's structured-output overhead. There is no
  server-side equivalent to compare against — `local-server` mode has never
  generated a report either (see ADR-0003's report-prompt note).
- **persistence**: OPFS read-modify-write per turn (`opfs-store.ts`) is local
  disk I/O, not network — negligible next to any of the above.

No numbers are captured here yet; this is a latency _shape_ map (what talks
to what), not a benchmark. Recommended follow-up in `04-m3-rag-ingestion`
scope: measure with the mock provider (`evals/src/mock-provider`) once one
exists.

## Static deploy (Cloudflare Pages)

The static bundle (`web/dist/client` after `cd web && bun run build`) is a
plain SPA — no CF Worker, no server code — so `client-only` mode is the only
mode a static deploy can offer (there is no `di` binary to reach, so
`$effectiveRuntime` always resolves to `client-only` per the probe logic in
`web/src/lib/runtime.ts`).

- **Build output**: `web/dist/client`, one prerendered `index.html` per
  locale directory plus a root fallback. Point the Pages project's build
  output directory at `web/dist/client`.
- **Build command**: `cd web && bun run build` (bun, not npm/pnpm — see root
  `AGENTS.md` package-manager rule).
- **No secrets to configure**: BYO provider `baseUrl`/`apiKey` are entered by
  the end user at runtime (`$providerProfile`, persisted client-side) and
  never touch the deploy pipeline.
- Deploys run through the Cloudflare Pages dashboard's Git integration
  (push to `main` = build + publish). There is deliberately no
  `deploy-web.yml` workflow: it never worked (`Script not found
"wrangler"` — no `CLOUDFLARE_API_TOKEN` secret) and was removed as
  redundant with the Git integration.
