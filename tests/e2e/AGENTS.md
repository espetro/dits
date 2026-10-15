# tests/e2e/AGENTS.md

Readable scenario source of truth is `specs/*.md`; each `*.spec.ts` must stay in sync with those headings (a check enforces this).

`mise run e2e` is the only entry point and is self-contained: `harness/up.ts` starts the built SPA behind a test-mode di server on :3100, mock providers on :3101 (cors), :3102 (no-cors), :3103 (failure injection), a static no-server copy of the SPA on :3104, runs every spec and tears down. Needs `mise run build` first. Extra args go to playwright (`mise run e2e -- provider-relay.spec.ts -g "401"`).

`mise run e2e:smoke` runs only specs tagged `@smoke` (the pre-push tier).

After any run, `cat tests/e2e/test-results/summary.txt` lists one line per test (`PASS|FAIL|SKIP file:line title first-error artifact-dir`) and the server log path on failure. Traces and screenshots are kept for failures only.

Browser state comes from `harness/seed.ts` (named seeds, one key map; `bun harness/check-keys.ts` fails when the app renames a key) and screens are driven through `harness/pom.ts`. Never inline localStorage seeds or screen locators in a spec. The client-only specs apply the `noServer()` seed, otherwise the SPA finds the di server and routes the LLM through its relay instead of the page's own `page.route` mocks.

The on-device voice mock in `wasm-voice.spec.ts` speaks the kkrpc wire protocol; if kkrpc changes it, that is the one place to update.
