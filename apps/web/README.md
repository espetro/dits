# di web (SPA)

TanStack Start single-page app. Build output is `apps/web/dist/client`
(`mise run build` from the repo root). Copy `apps/web/.env.example` to
`apps/web/.env.local` if you need to override defaults; all vars are optional.

## Local development without API keys

Everything below runs fully locally with no real LLM/STT/TTS keys.

### Client-only mode with the mock provider

1. Start the OpenAI-compatible mock provider (CORS-enabled, browser-safe):

   ```
   mise run dev:mock
   ```

   This runs `packages/evals/mock-provider/main.ts` on http://localhost:9000 with
   deterministic `/v1/chat/completions`, `/v1/audio/transcriptions`,
   `/v1/audio/speech`, `/v1/embeddings` and `/v1/models` responses
   (port override: `--port <n>`; health probe at `/health`).

2. Start the web dev server: `mise run dev` (http://localhost:5173).

3. In the app, open AI Provider settings and configure the llm (and
   optionally stt/tts) section with:

   - Base URL: `http://localhost:9000`
   - API key: any non-empty string (e.g. `sk-mock`)
   - Model: `mock-llm` (stt/tts model values are ignored by the mock)

   Client-only LLM calls take their base URL from the provider profile
   saved in these settings, not from `VITE_DI_API_BASE`. That env var only
   affects the server health probe and server-driver websocket calls, so it
   can stay unset in client-only mode.

4. Pick the client-only runtime mode in settings, then run an interview.

### Dev OPFS fixtures (history/report/finish data)

With the dev server running, open:

- `http://localhost:5173/?fixtures=1` : seeds 2-3 fake completed interview
  sessions (with turns, and a report for one) into OPFS so the history,
  report, and finish screens have data. Idempotent: a `di.fixtures-seeded`
  localStorage marker prevents reseeding on later boots.
- `http://localhost:5173/?fixtures=reset` : clears the marker and reseeds
  (rewrites the fixture sessions in place).

Both are gated on `import.meta.env.DEV`, so production builds never ship
the seeder. Fixtures are appended to (not replacing) any real local sessions.
