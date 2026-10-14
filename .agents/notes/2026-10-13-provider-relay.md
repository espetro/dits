# provider relay session (2026-10-13, issue #80)

branch work landed as commits cae22ab..b9c4616 on main (not pushed).

## environment gotchas discovered

- root `bun test` fails here: workspaces resolve deps per-package; tests run
  via `cd <pkg> && bun run --bun vitest run` (apps/web: `bunx vitest run`).
  vitest 5: no `--reporter=basic`.
- `tools/dscheck/bun.lock` is lockfileVersion 2 (bun >= 1.4) but mise pins
  bun 1.3.14, so `mise run validate:quick`'s dscheck leg fails with
  "UnknownLockfileVersion" on CLEAN HEAD. Pre-existing; do not chase it as a
  regression. Needs either bun upgrade or a v1 lockfile regen.
- tests/e2e is its own install: `bun install` + `bunx playwright install
  chromium` needed fresh; its committed bun.lock resolves @playwright/test
  1.64.0 under `^1`.
- the di server keeps running after tool-timeout kills (nohup'd bash
  wrappers): check `ps aux | grep cli.ts` + `lsof -iTCP:3000` before e2e;
  a stale server without the relay route cost an hour of debugging. Restart
  with `cd apps/server && DI_TEST_MODE=1 bun run src/cli.ts --config
  ../../config.example.yaml` (there is NO --no-supervise flag despite the
  comment in playwright.config.ts).
- machine load (foreign vitest/tsc processes from other projects) makes the
  client-only e2e specs (typed turn etc.) flaky with "voice error" timeouts;
  they pass in isolation. Baseline any e2e failure before blaming a diff.

## relay design facts (for future work)

- `relayActive(baseUrl)` = `$serverReachable.get() === true && !isDemoLlm` —
  the store is only probed from `/setup` mount + client entry
  (apps/web/src/client.tsx calls ensureRuntimeProbe; added in edd6ad0 after
  the landing-page path left it null = browser-direct = the desktop bug).
- BrainSection has its OWN createOpenAiCompatibleModel call (not
  createLlmModel); any fetchImpl seam change must touch both
  settings-brain-section.tsx and settings-drafts.tsx.
- mock provider: `--port N --no-cors` CLI (space form fixed in ffe09e0),
  `GET /__state` returns {lastHeaders, inflight} for e2e assertions.
- relay e2e preconditions: di server test mode on :3000 + web dev server
  `VITE_DI_API_BASE=http://localhost:3000 bun run dev` + mock :9000 (specs
  spawn their own no-cors mock on :9100). `mise run e2e-relay`.
- in-page client-agent turns with a reachable server: seed
  di.voice.sttEngine/ttsEngine = "in-browser" (any non-server pick forces the
  browser driver even when $serverReachable is true).
