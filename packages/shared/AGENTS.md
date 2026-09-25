# packages/shared/AGENTS.md

`@di/shared` — valibot contracts only, no runtime imports. Any API or shared
type change starts here.

- `config.ts` - config schema + `DI_` env override rules. Env overrides use `DI_` + `__` separator (`DI_LLM__MODEL`); digit-only values coerce to numbers; nested keys lowercase after the prefix.
- `session.ts` - session/turn/report/tool-state/event schemas.
- `plan.ts`, `report.ts` - report payloads: `overall_score` and competency scores are 0..10 (not 0..100); `competencies[].evidence[].verdict` is `worked|improve|drop`.
- `voice.ts` - WebSocket voice message envelope, discriminated union on `t`. Not reflected in `/v1/openapi.json`.
- `interview-agent.ts` - system prompt builder, `voiceToolsFor`/`VOICE_TOOLS`, `TOOL_AGENT_ACCESS`, `cutSentences` — shared by the server voice loop and the browser client-only agent. Pure, must run in both Bun and the browser.

## Type style (bites hardest here — this package is the contract layer)

- `interface` over `type` for object shapes — oxlint `typescript/consistent-type-definitions` enforces this.
- `extends` over `&` for composition — interface members resolve lazily and are cached; intersections recompute structurally, which is slower under tsgo.
- No inline object-type function params — extract a named interface (ast-grep rule in `rules/`).
- Exhaustive unions: add `assertNever(x: never): never` and use it in the `default` of a `switch` — tsc is the enforcer at the `never` position.
