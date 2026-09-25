<p align="center">
  <img src="apps/web/public/icon-192.png" width="96" height="96" alt="di. icon" />
</p>

<h1 align="center">di.</h1>

<p align="center">Practice interviews with a real-time AI voice agent. Runs entirely on your machine.</p>

<p align="center">
  <a href="https://github.com/espetro/dits/releases"><img src="https://img.shields.io/github/v/release/espetro/dits" alt="latest release" /></a>
  <a href="https://github.com/espetro/dits/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-CPAL--1.0-blue" alt="license: CPAL-1.0" /></a>
  <a href="https://x.com/josocjoq"><img src="https://img.shields.io/twitter/follow/josocjoq?style=social" alt="Follow @josocjoq" /></a>
</p>

## Try it now

[🇬🇧 en](https://dits.illo.fyi/) · [🇩🇪 de](https://dits.illo.fyi/de) · [🇪🇸 es](https://dits.illo.fyi/es) · [🇫🇷 fr](https://dits.illo.fyi/fr) · [🇯🇵 ja](https://dits.illo.fyi/ja) · [🇧🇷 pt-BR](https://dits.illo.fyi/pt-BR) · [🇨🇳 zh-CN](https://dits.illo.fyi/zh-CN) · [🇰🇷 ko](https://dits.illo.fyi/ko) · [🇮🇹 it](https://dits.illo.fyi/it) · [🇸🇦 ar](https://dits.illo.fyi/ar)

## Set it up with your coding agent

Want your coding agent to clone, build, and drive a full interview session for you (no API keys needed)? Point it at this one-liner:

```sh
curl -fsSL https://raw.githubusercontent.com/espetro/dits/refs/heads/main/.agents/docs/setup-prompt.md
```

Paste the output into the agent as its task.

## Run it yourself

See [docs/setup.md](docs/setup.md) for the full step-by-step guide: download a release or build from source, configure a real LLM/STT/TTS provider, and run your first interview.

## What it does

- Reads a CV/job description and turns it into an interview plan (preset or custom prompt).
- Runs a real-time voice interview over WebSocket, backed by any OpenAI-compatible LLM, STT, and TTS provider (OpenAI, Ollama, vLLM, ...).
- Grounds the agent's questions in your uploaded documents via retrieval.
- Produces a transcript and a scored report at the end, kept in local history.
- Self-hosted and local-first: one process serves the API, web app, and in-process voice pipeline, and a SQLite database holds everything.

## Stack

| Path               | What it owns                                                  |
| ------------------ | ------------------------------------------------------------- |
| `packages/shared/` | Contracts (`@di/shared`): config, session/turn/report schemas |
| `apps/server/`     | Hono API on Bun, in-process WebSocket voice pipeline          |
| `apps/web/`        | TanStack Start SPA                                            |
| `packages/evals/`  | vitest suite + offline mock provider                          |

Full config reference and API table: [`.agents/docs/config-reference.md`](.agents/docs/config-reference.md).
