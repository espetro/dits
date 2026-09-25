# AGENTS.md

di is a local-first AI mock interview agent: configure an interview, optional
validate step, voice interview over WebSocket, transcript and report, history.
Bun monorepo; domain logic depends on injected port interfaces (see
`.agents/docs/adr/0002-websocket-voice.md`). Two runtimes: the Hono server
(Bun) and the SPA (browser). Valibot contracts in `packages/shared/` are the
anti-corruption layer between them.

## Layout

`apps/` holds deployables, `packages/` holds shared libraries; both are bun
workspaces.

- `apps/server/` - Hono API on Bun + the voice pipeline; the `di` CLI deliverable. [apps/server/AGENTS.md](apps/server/AGENTS.md)
- `apps/web/` - TanStack Start SPA, bundled into `di` via `apps/web/dist/client`. [apps/web/AGENTS.md](apps/web/AGENTS.md)
- `packages/shared/` - `@di/shared`. Contracts only. [packages/shared/AGENTS.md](packages/shared/AGENTS.md)
- `packages/evals/` - vitest eval suite + `mock-provider/main.ts` (OpenAI-compatible mock).
- `tests/e2e/` - Playwright specs; deliberately NOT a workspace member (black-box client of a running server, owns its deps). [tests/e2e/AGENTS.md](tests/e2e/AGENTS.md)
- `spikes/` - throwaway explorations; never workspaces, each owns its deps. Anything promoted moves to `packages/`.
- `.agents/docs/screens/*.md` - screen specs; update in the same commit as any route behavior change.

## Gate commands

`mise` tasks (`mise.toml`), tiered by cost — see `scripts/validate.ts`:

- `mise run validate:staged` - T0 (<2s): oxfmt/oxlint/import-paths. Runs in pre-commit.
- `mise run validate:quick` - T1 (~10s): T0 + ast-grep scan + ratchets. Run freely per change.
- `mise run validate` - T2: T1 + affected typecheck/test via turbo, queued (`ts -S 1`). Runs in pre-push.
- `mise run validate:full` - T3: everything, full repo + knip. Milestone/CI gate, not per-commit.
- `mise run dev` / `mise run build` / `mise run test` / `mise run e2e` / `mise run smoke`

Cheap gates run freely; heavy gates (T2/T3) go through the queue and should
not run concurrently with active subagents. A mechanical change failing the
gate twice means narrow the batch, not hand-edit around it.

## Conventions

- Contracts live in `packages/shared/` as valibot schemas; never hand-roll request shapes in `apps/server/`/`apps/web/`.
- Type style: `interface` over `type` for object shapes (oxlint-enforced), `extends` over `&` for composition, no inline object-type params — see the ast-grep rules in `rules/`.
- Commits: conventional commits, atomic, no co-author trailers.
- Package manager: bun only, never `npm`/`npx`. Toolchain via `mise`.
- Formatting: lowercase-technical docs style, no em dashes.
