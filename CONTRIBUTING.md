# Contributing to dits

Thanks for helping build an open, local-first, voice-first interview coach. This guide
gets you from a clean clone to a green test run, explains how the monorepo is
organized, and describes the conventions we hold PRs to.

dits is a fork of [DeepInterview](https://github.com/ngoanpv/DeepInterview) and is
still an **early build**. See [AGENTS.md](AGENTS.md) for the fuller orientation this
guide summarizes.

---

## 1. Dev setup

**Prerequisites**

- **[bun](https://bun.sh)** — the only supported package manager. Never `npm`/`npx`.
  The root `package.json` pins `packageManager: bun@*`.
- **[mise](https://mise.jdx.dev)** — runs the dev tasks (`mise.toml` pins bun and
  node 24).
- **Docker** — only needed for the full local voice stack
  (`scripts/local-voice-stack.sh`).

**The offline setup (no API keys required)**

```bash
git clone https://github.com/espetro/dits.git dits
cd dits

bun install
mise run build            # web SPA build + worker esbuild bundle
mise run test              # vitest across shared, server, worker, web, evals
```

Then run the server against the in-repo mock provider — no keys needed:

```bash
cp config.example.yaml config.yaml
bun run packages/evals/mock-provider/main.ts --port 9000 &
bun run apps/server/src/cli.ts --config config.yaml
```

### Running offline (the mock-first rule)

**You should never need a paid API key to develop or run the test suite.** The
`packages/evals/mock-provider` is an OpenAI-compatible mock server (chat, transcription,
models endpoints) that every LLM/STT/TTS provider config can point at. This keeps
CI hermetic and lets new contributors run the whole configure → interview → report
flow on day one.

If you add a feature that talks to a provider, it **must** keep working against the
mock provider so the offline path stays green.

---

## 2. Monorepo map

Bun workspaces, `mise` tasks. See [AGENTS.md](AGENTS.md) for the authoritative,
kept-up-to-date layout; summary:

| Path               | What it owns                                                                                                                                                                           | Language            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `packages/shared/` | **The contract.** `@di/shared` — valibot schemas for config, session/turn/report/tool-state/event. Any API change starts here.                                                         | TS (valibot)        |
| `apps/server/`     | Hono API on Bun, `bun:sqlite` storage via Kysely. `src/cli.ts` is the entry; `src/supervisor/` spawns worker + LiveKit children. Serves the built web SPA from `apps/web/dist/client`. | TS (Bun)            |
| `worker/`          | `@livekit/agents` voice worker. Tools: `read_editor`, `read_whiteboard`, `update_question`. STT/TTS/LLM all speak OpenAI-compatible HTTP.                                              | TS                  |
| `apps/web/`        | TanStack Start SPA — `/`, `/setup`, `/validate/$id`, `/interview/$id`, `/finish/$id`, `/report/$id`, `/history`.                                                                       | TS (TanStack Start) |
| `packages/evals/`  | vitest eval suite plus `mock-provider/main.ts`, the OpenAI-compatible mock server.                                                                                                     | TS                  |
| `tests/e2e/`       | Playwright spec executing scenarios from `specs/*.md`. Needs a running test-mode server (`DI_URL` to target it).                                                                       | TS                  |
| `docs/`            | Architecture + setup docs.                                                                                                                                                             | Markdown            |

**Cross-cutting rule:** `packages/shared/` is the single source of truth for request/response
shapes. Server routes validate against it with `@hono/valibot-validator`; never
hand-roll request shapes in `apps/server/` or `apps/web/`.

---

## 3. Conventions

### Commits & PRs

- **[Conventional Commits](https://www.conventionalcommits.org/):** `feat:`, `fix:`,
  `docs:`, `chore:`, `refactor:`, `test:`.
- **Small PRs, one concern.** Describe what you changed and how you verified it
  offline.

### Code style

- **TS:** `oxfmt`/`oxlint` format and lint the workspace. TypeScript is strict.
- **Formatting:** lowercase-technical docs style, no em dashes.
- **Keep the live loop lean:** no blocking network/RAG I/O on the turn path — see
  [AGENTS.md](AGENTS.md) for the per-route contract docs under
  `.agents/docs/screens/*.md`.

### Tests

- Run `mise run test` (vitest across shared, server, worker, web, evals) and
  `mise run check` (adds `tsc --noEmit` in web) before opening a PR. Both must
  pass **offline**.
- `mise run e2e` runs the Playwright suite against a test-mode server you start
  yourself (`DI_TEST_MODE=1`); see [AGENTS.md](AGENTS.md#test-mode-driving-recipe).

---

## 4. Licensing, DCO sign-off & attribution

- **dits is licensed under [CPAL-1.0](LICENSE)**, building on the original
  [DeepInterview](https://github.com/ngoanpv/DeepInterview) codebase
  (Apache-2.0) — see [NOTICE](NOTICE) for the full attribution chain. By
  contributing you agree your contribution is licensed under CPAL-1.0.
- **Sign off your commits (DCO).** We use the lightweight
  [Developer Certificate of Origin](https://developercertificate.org/) instead of
  a CLA — no paperwork, no bot. Add a `Signed-off-by` line by committing with the
  `-s` flag:

  ```bash
  git commit -s -m "feat(worker): add Deepgram STT adapter"
  ```

  This certifies you wrote the change (or have the right to submit it) under the
  project's license. Forgot it on an existing commit? `git commit --amend -s` (or
  `git rebase --signoff` for a range), then force-push your branch.

- **Never commit secrets.** Keys live in `.env` only (gitignored). See
  [SECURITY.md](SECURITY.md).

---

## 5. Getting help

<!-- TODO: no Discussions/Discord/chat channel is set up yet for this fork; add one
     here once it exists. -->

- 🐛 [Issues](https://github.com/espetro/dits/issues) for bugs/features.
- 📜 Be kind — we follow the [Code of Conduct](CODE_OF_CONDUCT.md).

Welcome aboard.
