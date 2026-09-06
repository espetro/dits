# Screen: Landing (`/`, `/{-$locale}`) — Variant B "playful notebook"

The landing lives under the optional `{-$locale}` route segment: `/` is the en
landing, `/es`, `/fr`, ... are locale landings. All in-app routes share the
same optional prefix (`/setup`, `/es/setup`, ...). Locale switching swaps the
prefix via real links, so prerender crawl discovers every locale page.

## ASCII mockup

```
+------------------------------------------------------------------+
|  [logo di]                                    history   github   |
+------------------------------------------------------------------+
|                                                                  |
|   ~ practice like you mean it ~                                  |
|                                                                  |
|   THE AI AGENT            +----------------+                     |
|   YOU PRACTICE            :  [sticker 1]   :                     |
|   YOUR INTERVIEWS WITH.   :  "tell me     :   +---------------+  |
|   (chunky rounded         :   about a time:   :  [sticker 2]   :  |
|   display type, tilted)   :   you failed." :   :  system design :  |
|                           +----------------+   :  45 min, hard  :  |
|        +-------------------+                   +---------------+  |
|        |  [sticker 3]      |      +---------------------------------+
|        |  behavioral q's   |      |  [sticker 4] why did you     |
|        |  quick fire       |      |  [sticker 5] leave your job? |
|        +-------------------+      +---------------------------------+
|                                                                  |
|              +-----------------------------+                     |
|              |        grill me ->          |   (=> /setup)       |
|              +-----------------------------+                     |
|                                                                  |
|        voice interviews with an AI that actually pushes back.    |
+------------------------------------------------------------------+
```

## Behavior

- Shared AppHeader (from `__root`): logo, GitHub icon link, placeholder account button.
- CTA **"grill me ->"** navigates to `/setup` (locale-prefixed).
- Locale switcher in the header area: real links to `/`, `/es`, ... so crawlLinks prerenders all locale pages.
- 5 tilted sticker/post-it cards with real interview-question content, placed at edges; decorative rotation, no interactivity.
- **Grid slot allocation** (`web/src/components/landing-page.tsx`): scattered
  stickers are absolutely positioned into one of 5 fixed, non-overlapping
  slots (fractions of the hero band) via `--slot-x`/`--slot-x-compact`/`--slot-y`
  CSS custom properties, gated by container queries on the `@container/hero`
  band: a compact tier (`@[42rem]`, narrower `xCompact` spread, `w-40` cards)
  and the full tier (`@[54rem]`, full `x` spread, `w-52` cards). On each mount
  the stickers are shuffled
  across the slots (Fisher-Yates), so the composition varies per reload
  while never overlapping the headline, CTA, or locale pill. This keeps long
  localized sticker text (de/pt/zh) from drifting into the hero as it did
  with the original hand-tuned offsets.
- Trust micro-line under CTA: single sentence, no stats (v1).

## Responsive

- Mobile-first; base styles target 375px. On mobile the stickers render as
  two flow strips (above the hero, below the CTA) via the `@[42rem]/hero:contents`
  wrappers; absolute slot positioning activates on the hero band's own width
  (container queries, not viewport breakpoints): compact scatter from a 42rem
  band, full scatter from 54rem. CTA button is full-width below `sm`
  (`w-full sm:w-auto`). Text sizes and paddings use existing `md:` steps; no
  fixed widths.

## Notes

- Warm cream bg + orange accents (Variant B tokens from `theme.css`).
- Screen state is fully static; no URL params, no store reads.
