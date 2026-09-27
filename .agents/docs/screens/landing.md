# Screen: Landing (`/`, `/{-$locale}`) — "product peek"

The landing lives under the optional `{-$locale}` route segment: `/` is the en
landing, `/es`, `/fr`, ... are locale landings. All in-app routes share the
same optional prefix (`/setup`, `/es/setup`, ...). Locale switching swaps the
prefix via real links, so prerender crawl discovers every locale page.

Pixel-faithful target: `.agents/mockups/landing-peek.html` (+ the
`landing-peek-1440.png` / `landing-peek-390.png` reference shots).

## ASCII mockup

```
+------------------------------------------------------------------+
|                                                                  |
|                    [ mock interviews ]  (espresso pill)          |
|                                                                  |
|          THE AI AGENT YOU *practice* YOUR INTERVIEWS WITH.       |
|              (fraunces black, em word in persimmon italic)       |
|                                                                  |
|           voice interviews with an agent that actually           |
|              pushes back. then get the receipts.                 |
|                                                                  |
|                    (  grill me  (o->)  )   (=> /setup)           |
|                                                                  |
|   +----------------------------------------------------------+   |
|   | di.  system design · mid-level            07:41 / 20:00  |   |
|   +---------------------------+----------------------------+   |
|   | [QUESTION 2 / 5]          | NOTES                      |   |
|   | (orb) LISTENING           |  failure story — billing…  |   |
|   |  tell me about a time…    |  probing — first response… |   |
|   | AGENT  where on your…     |                            |   |
|   | YOU    at my last job…    |                            |   |
|   | AGENT  what broke…        |                            |   |
|   | ||||| waveform    YOU·MIC |                            |   |
|   | ( talk or type…         ) |                            |   |
|   |        [ • • x ] pillbar  |                            |   |
|   +---------------------------+----------------------------+   |
|                    ~~ fold: card continues below ~~              |
+------------------------------------------------------------------+
```

## Behavior

- Headerless: `__root`'s `AppHeaderSlot` returns null when the index route
  matches (`useMatch("/{-$locale}/")`), so no top nav renders on the landing.
- CTA **"grill me"** is a persimmon pill with a circular arrow-dot affordance;
  navigates to `/setup` (locale-prefixed). On the public-site build
  (`VITE_PUBLIC_SITE=1`) it links to the setup docs on GitHub instead.
- The `peek` card is a presentational miniature of the interview screen
  (`role="img"` + localized `landing.peek.aria` label; every inner string is a
  `landing.peek.*` i18n key): 40px callbar (di. logo + scenario + tabular-nums
  timer), then a grid — conversation card (question chip, 44px orb stage row
  with LISTENING status + Fraunces caption, agent/you transcript rows, mic
  waveform strip above a "talk or type" composer) and a notes rail — plus a
  floating espresso icons-only pillbar (mic / transcript / end) absolutely
  pinned at the card's bottom edge.
- `width: min(860px, 100%)`, top-only radius, no bottom border — the card runs
  below the fold on purpose; the pillbar peeks at the fold.
- The orb and wave bars are decorative CSS approximations (`.peek-orb`,
  `.peek-wave` in `theme.css`), not the live vendored orb/waveform — the peek
  is static mock content. Both honor `prefers-reduced-motion`.
- The sticker field (scattered tilted question cards) is gone — deleted
  outright, along with its `landing.sticker.*` / `landing.trust` locale keys
  and the floating locale pill. Locale switching lives in the account
  dropdown on every other route; the prerender `pages` list in
  `vite.config.ts` still covers every locale landing.

## Responsive

- Breakpoint at 700px (`min-[700px]:` / `max-[700px]:`), matching the mockup.
- Mobile: single column — the notes rail and the callbar timer are hidden;
  headline steps down to `clamp(34px, 10.5vw, 44px)`; hero padding drops to
  `pt-12`. No horizontal overflow at 390px (verified via scrollWidth).
- Desktop: conversation card `minmax(300px, 38%)` + flexible notes column.

## Notes

- Warm cream bg + orange accents (Variant B tokens from `theme.css`).
- Screen state is fully static; no URL params, no store reads.
