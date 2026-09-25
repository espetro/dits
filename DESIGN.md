# DESIGN.md - di visual contract

> Token values: `web/src/theme.css` `@theme` is normative. This file names
> the system and the rules. Never copy a token value into this file or a
> component - reference the token name.

## 1. read

"playful notebook": warm cream ground, espresso ink, persimmon accent.
serif display (Fraunces) + sans body (Inter var) + mono (Berkeley Mono).
ambient layers: film grain (`.grain`), radial orbs (`.ambient`),
ease-out-expo motion. warm, editorial, low-chrome - not a dashboard.

## 2. token taxonomy

| layer             | examples                                                                                                                        | who may use                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| primitives        | `--color-cream/-espresso/-persimmon/-sage/-sky-note/-butter`                                                                    | `theme.css` only - never referenced raw in components         |
| semantic (shadcn) | `--color-background/-foreground/-card/-popover/-primary/-muted/-accent/-destructive/-border/-input/-ring`                       | components, via utilities: `bg-card`, `text-muted-foreground` |
| di palette        | `bg-cream`, `bg-paper`, `bg-espresso`, `bg-persimmon`, `bg-persimmon-soft/-faint`, `text-espresso-soft/-faint`, `ring-hairline` | components                                                    |
| type              | `font-display`, `font-body`, `font-mono`                                                                                        | components                                                    |
| radii             | `rounded-card` (1.5rem), `rounded-shell` (2rem)                                                                                 | components                                                    |
| ambient           | `.grain`, `.ambient`, `.reveal`, `.rise-in`, `.orb-live`                                                                        | decorative layers only                                        |

rule: style via semantic or palette utility classes. arbitrary values are
confined to `theme.css`. raw hex in a component = lint error (section 7).

## 3. component recipes (do not invent alternatives)

- **cta / button**: vendored `Button` only. primary action = espresso pill,
  ArrowRight slides on hover, `active:scale-[0.97]`. never bespoke `<button>`
  markup for actions.
- **surface**: card = `bg-paper rounded-card ring-1 ring-hairline`.
  translucent overlay = `bg-paper/15 backdrop-blur` (transcript rail).
- **form fields**: formisch + `@di/shared` schema validation. option sets =
  `ToggleGroup` pills, never hand-rolled buttons. text inputs = pill-shaped,
  `ring-1 ring-hairline`, `focus-visible:ring-persimmon/50`.
- **status text**: small-caps mono - `text-[0.65rem] tracking-[0.15em]
uppercase text-espresso-soft`.
- **icon buttons**: lucide only, ghost variant.
- **new primitive**: `bunx shadcn@latest add <name>` into
  `src/components/vendor/`, separate commit, `bunx oxfmt` after. never edit
  vendored files.
- **new component**: build on vendored primitives in `src/components/`,
  one component per file, props typed with `interface`.

## 4. screen contracts

per-route behavior + responsive specs live in `.agents/docs/screens/*.md`.
any commit that changes layout, sections, ctas, states, or nav updates the
matching spec in the same commit (e2e headings enforce sync).

## 5. responsive law

mobile-first, 375px base; `md` (768px) = rail <-> sheet switch; `lg`
allows two-up splits. every route must be usable at 375 and 1440. mobile
adapts with vendored `sheet`/`drawer`, never bespoke drawers. overflow:
truncate or collapse, never clip mid-element. touch targets >= 44px.

## 6. voice surface rules

state word always accompanies the orb - never color alone. vocabulary:
`idle`, `connecting`, `listening`, `thinking`, `speaking`, `interrupted`,
`reconnecting`, `error` (matches the xstate turn fsm). volume animates the
orb; state drives the word. presence + current utterance = one zone
(`AgentStage`); controls = one sticky cluster (`ControlBar`); muted and
degraded states are visible, not guessed.

## 7. enforcement

- `dscheck` (T1 gate): reads `@theme`; off-system color or fabricated
  `var(--…)` = error naming the right token; `--format agent` output.
- `components/vendor/**` is generated - lint excludes it.
- i18n: all user-visible strings via locales; vendor components with
  hardcoded english get a di comment (existing convention).
- `web/AGENTS.md` design-token rules are binding: semantic classes only,
  never raw hexes, never edit vendored files.

## 8. do not

- do not add a second token source (no design-tokens.json fork by hand;
  generate if ever needed).
- do not introduce a new css framework, css-in-js lib, or component lib
  (adr-0004 locks react + tailwind v4 + shadcn; new primitives come from
  ark ui or shadcn cli).
- do not hand-roll controls shadcn ships (button, input, label, tabs,
  radio-group, select, dialog, dropdown-menu, sheet).
- do not write screen-level docs in this file - screens live in
  `.agents/docs/screens/`.
