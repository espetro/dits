# tests/e2e/AGENTS.md

Readable scenario source of truth is `specs/*.md`; `playwright.spec.ts` must
stay in sync with those headings (a check enforces this).

Requires a running test-mode server; target from `DI_URL` (default
`http://localhost:3000`). `mise run e2e` does not start the server — start it
yourself first (see `apps/server/AGENTS.md` test-mode recipe).
