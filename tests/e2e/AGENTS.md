# tests/e2e/AGENTS.md

Readable scenario source of truth is `specs/*.md`; `playwright.spec.ts` must
stay in sync with those headings (a check enforces this).

`mise run e2e:settings` is self-contained: `harness/up.ts` starts the built
SPA behind a test-mode server on :3100 plus mocks on :3101 (cors), :3102
(no-cors), :3103 (failure injection), runs `provider-relay.spec.ts` and tears
down. Needs `mise run build` first. Extra args go to playwright
(`mise run e2e:settings -- -g "401"`).

The other specs require a running test-mode server; target from `DI_URL` (default
`http://localhost:3000`). `mise run e2e` does not start the server — start it
yourself first (see `apps/server/AGENTS.md` test-mode recipe).

Preconditions beyond the di server:

- mock provider on :9000 (`bun run packages/evals/mock-provider/main.ts
--port 9000`) — the test-mode config points every provider at it, and the
  report-generation spec needs its canned `report` fixture.
- web dev server on :5173 for the client-only + voice-harness specs:
  `cd apps/web && VITE_DI_API_BASE=http://localhost:3000 bun run dev`
  (without `VITE_DI_API_BASE` the harness page never reaches the server
  driver). Override with `DI_WEB_URL`.
