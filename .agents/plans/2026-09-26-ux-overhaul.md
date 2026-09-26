# plan: ux overhaul — landing, interview, settings, i18n, fonts

status: pending quim review (2026-09-26)
source: four research streams + user brief with annotated screenshots
related: adr-0004 (stack stays: react + tailwind v4 + vendored shadcn),
  `.agents/docs/screens/*` (updated per phase), `DESIGN.md`

## 0. brief recap

- landing layout is broken and blocks the `/setup` cta on desktop
- `/interview` does not fit one viewport; wants a from-scratch redesign on
  pre-made components
- settings are confusing (three overlapping surfaces, too technical); wants
  one unified settings ux, spotify-style rows, consent-driven wasm
- `/setup` components non-standard and non-a11y; adopt a pre-made design
  system; custom components live in their own file on top of it
- all copy in i18n files; lowercase locale codes (`pt-br`, not `pt-BR`);
  assess `intl-ai@v0.5.0`
- adopt cauce's body font (plus jakarta sans variable); keep fraunces for
  the logotype

## 1. landing — diagnosis + candidates

research verified live (dev server, measured rects + elementFromPoint).

two real bugs:

1. **invalid `calc()`**: `StickerCard` passes `--slot-x` as a percentage and
   the class computes `left: calc(var(--slot-x) * (100% - 13rem))`. css `*`
   needs a unitless operand, so `left` drops to `auto` and every sticker
   collapses to a left column over badge -> headline -> cta.
2. **stickers eat clicks**: positioned decorative cards have no
   `pointer-events-none`, so the y=64% slot sits directly over the cta;
   `elementFromPoint` returns the sticker for every point on the button.
   `/setup` is literally unclickable. the 0.5-1.1s `rise-in` delays make
   invisible stickers hit-testable too.

even with valid math the slot map is unsound: the intended x band
intersects the `max-w-3xl` headline, and localized copy shifts the ground
under viewport-fraction arithmetic.

options:

- **a — contained canvas** (lowest risk): `lg:` two-column hero, stickers
  absolutely positioned inside a dedicated `relative` cell. overlap becomes
  impossible by box topology. mobile keeps a capped 3-strip row.
- **b — product preview hero**: centered copy + cta above a mock
  agentstage card (orb + caption + question chip + control bar). the
  decoration is the product.
- **c — orb-forward** (research pick): the breathing orb + state word is
  the hero; chips pinned to far margins only, hidden < 900px. fits one
  viewport everywhere and previews the voice surface.

recommendation: ship a small unbreak now (unitless slot vars or a
`left: calc(var(--slot-x) - 13rem)` + `pointer-events-none` + mobile strips
below cta), then the redesign of whichever candidate quim picks.

## 2. interview — single-viewport redesign

measured: the page is viewport + 68px at every size — `__root.tsx` renders
`AppHeader` on all routes and `interview.$id` then claims `h-[100dvh]`. the
controlbar lands fully below the fold at 1440x900 and 390x844. inside the
interview frame everything fits; the bug is the double header.

redesign spec (mockups attached):

- suppress `AppHeader` on `/interview/*`; replace with a 44px in-call bar
  (title + timer + end)
- desktop >= 768px: two-card grid `minmax(360px,34%) | 1fr`. left
  "conversation card": compact agentstage (orb 64px + status + 2-line
  caption) -> questioncard -> transcript stream (scrolls, flex-1) ->
  composer pinned at card bottom. right "workspace card": tooldock gets the
  full column height. floating bottom-center control pill:
  mute | transcript-toggle | end.
- mobile: slim bar -> compact stage -> question card -> tooldock (flex-1)
  -> fixed control pill (mute | type -> bottom-sheet | end); transcript
  stays the existing sheet
- nothing scrolls at page level; only transcript and tool panes scroll
  internally

component strategy (vendor, don't hand-roll):

- adopt ai elements `conversation` + `message` + `prompt-input` for the
  transcript pane (apache-2.0, vendored — repo already vendors 3 elements
  pieces). removes ~50 lines of bespoke scroll/input plumbing.
- add shadcn `resizable` + `scroll-area` for the desktop split
- keep bespoke `AgentStage`/orb and `ToolDock` — domain-specific, no lib
  covers them
- skip assistant-ui runtime (re-platforming our turns for its thread model)
  and park-ui as a system (panda-css only, second engine)

## 3. settings — one surface, spotify rows

audit found 6 overlapping surfaces; the "who runs voice" question is asked
three times with three different taxonomies (runtime chip, aiProvider
in-browser|custom-endpoint, voice pane on-device|builtin|endpoint), and
`resolveVoiceEngines()` arbitrates silently. consent is bundled invisibly
into a radio pick — `pickStt/pickTts` grants it and starts a 50mb download
with no prompt.

unified ia (keep the url-driven dialog, change the grammar to
title + one-line description + right control):

| nav | contents |
| --- | --- |
| past interviews | current history pane + clear-all |
| voice & microphone | mic, "understands you with" (stt), "answers you with" (tts), models row, test call |
| interviewer ai | the llm pick: demo (recommended) / your own ai account / on-device (experimental); endpoint fields reveal inline under "own account" |
| downloads | all model caches (voice wasm + browser llm): status, size, re-download, remove |
| language | app + interview language |
| advanced | runtime mode ("this browser / desktop app"), api flavor, custom endpoints — "most people never need this" |

rules:

- the voice pane's second picker set is deleted; the header chip becomes a
  status indicator that opens settings -> advanced
- wasm consent fires at point-of-need (first use of a feature that needs
  it); picking "on-device" while declined re-arms the prompt instead of
  silently granting; declined state shows "using browser built-in — switch
  anytime"
- every row gets a one-line plain-language description (copy drafted in
  the research report, lands in `en.json`)

design system: stay shadcn + radix. vendor the missing blocks:
`select field item empty progress separator collapsible tooltip alert`.
component rule (goes into DESIGN.md): vendor -> shadcn registry -> ark
primitive + tailwind -> custom file on vendored primitives. never raw
markup for a pattern a library ships.

## 4. setup — standardize + a11y

- scenario cards -> `RadioGroup` card options (one tab stop, arrow keys);
  start cta becomes a real button. kills the current nested-interactive
  `<article role=button>` wrapping a `<Button>` a11y violation.
- chip grids (duration/mode/tone/difficulty/language) -> labeled `Select`s
  + `RadioGroup` rows; language select renders `Intl.DisplayNames`, not raw
  `pt-BR`
- "more options" -> vendored `Collapsible`
- coach's disabled reason becomes inline description text, not a `title`
  tooltip; error banner gets `role=alert` + focus move

## 5. i18n

copy-in-code audit: mostly clean (~60 literals remain). worst offenders:
vendor `mic-selector` (~7), `SCENARIOS[].prompt` in setup.tsx (user-visible
+ feeds the llm), `lib/**` exception strings surfacing raw english via
toast (~20), vendor `live-waveform`/`dialog`/`sheet` aria-labels, meta
`<title>`s, display fallbacks. server errors return english strings —
add `error.code` and map codes -> keys client-side. `check-locales` runs
with `continue-on-error: true` — advisory only, and blind to copy-in-code.

lowercase locales: no runtime breakage (`Intl` canonicalizes `pt-br` ->
`pt-BR`). rename `pt-BR.json`/`zh-CN.json`, update `LOCALES` (session.ts +
vite.config.ts), `MESSAGES` imports, `LOCALE_META`, setup `LANGUAGES`, href
tests. add a case-insensitive -> lowercase redirect in `{-$locale}`
beforeLoad so legacy `/pt-BR/...` links land correctly. `di:locale` atom is
dead (url is source of truth) — delete.

intl-ai@v0.5.0: **adopt, after one fix**. `check` works on our files today
and is a strictly richer gate (staleness, unreviewed, icu, judge checks)
than check-locales; `fill` accepts openai-compatible providers and also
keyless local-agent providers (`agent = "claude-code"|...`). blocker:
`fill` writes nested json while we load flat dotted keys — either a ~5-line
flatten at load in `i18n.tsx`, or a small upstream pr adding a flat-shape
option (sigilco/intl-ai is quim's repo). wiring: `intl-ai.toml` at root,
commit `intl-ai.lock.d/` provenance, `fill` manual via mise task, `check`
in ci (drop `continue-on-error`).

## 6. fonts

cauce uses plus jakarta sans variable (body) + apfel grotezk (logo). we
adopt `@fontsource-variable/plus-jakarta-sans` as `--font-body` (replaces
inter var); `--font-display` stays fraunces for the logotype; berkeley mono
unchanged.

## 7. phasing

- w1: landing unbreak (small, ships immediately) + redesign per pick
- w2: interview single-viewport restructure + ai elements transcript
- w3: unified settings dialog + consent-driven wasm + chip -> status
- w4: setup standardization + design-system gap components + DESIGN.md rule
- w5: i18n — copy extraction, lowercase locales, intl-ai wiring
- w6: font swap

w2/w3 are the heavy lifts; each lands as its own pr with screen-spec doc
updates in the same commit.

## 8. open decisions for quim

1. landing direction: a (contained canvas), b (product preview), or
   c (orb-forward — research pick)?
2. settings stays a dialog or becomes a dedicated `/settings` page?
   (research recommends keeping the url-driven dialog)
3. custom endpoints inline per engine (proposed) vs one endpoints table
   under advanced?
4. interview language follows the lowercase ui locale or stays bcp-47 in
   stored sessions/drafts?
5. intl-ai flat-shape: 5-line flatten at load vs upstream pr to
   sigilco/intl-ai?
