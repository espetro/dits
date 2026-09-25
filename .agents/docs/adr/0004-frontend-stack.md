# ADR 0004: frontend stack verdicts (react + tailwind + shadcn locked)

status: accepted (2026-09-25)
builds on: ADR-0003 (client-only runtime)
plan: `.agents/plans/2026-09-25-remediation-e2e-and-ui.md`

## context

An adversarial stack audit was run to test the thesis that react + tailwind
is not token-efficient for agent-driven iteration (verbose class soup,
components mixing copy + presentation + useEffect logic, many solutions per
problem). The audit measured the actual repo and ported an equivalent
component across candidate stacks.

## measured evidence

- tailwind class attributes are **11.9%** of `.tsx` tokens (~7% of all
  web/src). the remaining ~90% is logic, types, i18n, api calls - a rewrite
  cannot delete it.
- this codebase is not class soup: ~3.3 classes per attribute site on
  average, vendored shadcn primitives, ratchets and ast-grep rules already
  enforce discipline.
- same dialog component, tokens (cl100k): react+shadcn 596, react+semantic
  classes 510 (-14%), react+daisyui 561, svelte5+bits 668, solid+kobalte 719.
- llm-training-data coverage favors react/ts/tailwind/shadcn; svelte and
  solid pools are thinner (documented runes-vs-legacy mixing errors).
- htmx/elm/rescript/lit disqualified outright: binary-audio websockets,
  canvas, wasm (vad onnxruntime), client-only opfs mode.
- migration estimate to svelte (best alternative): 3-5 agent-sessions,
  net-negative under this evidence.

## decision

- **stay on react 19 + tanstack + tailwind v4 + shadcn.** do not
  re-litigate without new measured evidence.
- **semantic-class consolidation**: map repeated class sets onto semantic
  tokens/recipes (~14% token cut). an afternoon pass, not a migration.
- **ark ui for new primitives** (hedge): zag fsm internals port verbatim
  to solid/svelte, keeping a migration path open without paying for it now.
- **xstate stays** for the voice turn fsm (barge-in and error recovery
  earn it); the setup flow correctly remains a form, not a machine.
- **no daisyui, stylex, htmx, elm, rescript** - disqualified on evidence.
- **tldraw pinned**: free for oss projects, not a blocker; planned later
  swap to a react-flow customization (same react ecosystem, zero
  rewrite risk).

## consequences

- design tokens and component recipes live in `DESIGN.md` + `theme.css`
  (`@theme` normative); `dscheck` enforces them at the T1 gate so agents
  cannot drift into raw hexes or invented patterns.
- if a dom-framework migration is ever revisited, the trigger conditions
  are: tldraw removal already done, agent-measured token delta >30% on
  real diffs, or ark ui coverage fails on a needed primitive.
- tanstack query/router and valibot contracts are load-bearing; any future
  port keeps `shared/` and the fsm layer unchanged.
