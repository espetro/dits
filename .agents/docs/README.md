# .agents/docs

Agent-facing operational documentation for the deep-interview monorepo.

## Index

| Doc                                        | Contents                                                                           |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| [screens/](screens/)                       | One file per screen: ASCII mockup, section inventory, CTAs, states, nav, key files |
| [user-flows.md](user-flows.md)             | Mermaid diagrams + step lists: main flow, runtime selection, error/recovery        |
| [stack.md](stack.md)                       | Stack runbook: layout, ports, config, start order, mise tasks, tests               |
| [config-reference.md](config-reference.md) | Full `config.yaml` key table, env override rules, `/v1/*` API summary              |
| [setup-prompt.md](setup-prompt.md)         | Agent-drivable clone-to-interview walkthrough over the `/v1/test/*` HTTP API       |
| [adr/](adr/)                               | Architecture decisions (0002 ws voice, 0003 client-only, 0004 frontend stack)      |
| ../plans/                                  | Plans referenced by ADRs (e.g. `2026-09-25-remediation-e2e-and-ui.md`)             |

Repo-root `DESIGN.md` is the visual contract (taxonomy, recipes, rules);
token values stay normative in `apps/web/src/theme.css`.

## Screen docs

- [landing.md](screens/landing.md) - `/`
- [setup.md](screens/setup.md) - `/setup`
- [validate.md](screens/validate.md) - `/validate/[id]`
- [interview.md](screens/interview.md) - `/interview/[id]`
- [finish.md](screens/finish.md) - `/finish/[id]`
- [report.md](screens/report.md) - `/report/[id]`
- [settings.md](screens/settings.md) - URL-driven settings dialog (`?settings=1`)
- [history.md](screens/history.md) - "Previous sessions" pane inside the settings dialog
- [navbar.md](screens/navbar.md) - persistent header chrome
- [notfound.md](screens/notfound.md) - not-found fallback

## Update policy

**Whenever a screen UI changes, update its ASCII mockup in the same commit.**

Rules:

1. Any commit that changes layout, sections, CTAs, states, or navigation of a screen MUST also update the corresponding file in `screens/` (mockup, section inventory, states, key files as applicable).
2. `setup.md` documents the **scenario-card (p3) state**; other screens
   document current state.
3. New screens get a new file in `screens/` plus entries in this index and in `user-flows.md`.
4. When a flow changes (new route, new status, new endpoint), update `user-flows.md` in the same commit.
5. Port numbers, commands, and config paths changed by infrastructure work must be reflected in `stack.md` in the same commit.
