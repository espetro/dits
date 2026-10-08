# Screen: Navbar (shared AppHeader)

Mounted in `__root` for every route except the landing (`/` and `/{-$locale}`
index, headerless by design via `useMatch("/{-$locale}/")`) and `/interview/*`
(the interview renders its own 44px CallBar — see interview.md): logo,
optional centered page title, LocaleSwitcher, GitHub link, and the account
dropdown (B3).

## ASCII mockup

```
+------------------------------------------------------------------+
|  [logo di]        page title          [language v] [gh] (G) v     |
+------------------------------------------------------------------+
                                                        +----------------+
                                                        | (G) Guest      |
                                                        |     local ...  |
                                                        | language [en v]|
                                                        | [history]      |
                                                        | [settings]     |
                                                        +----------------+
```

## Responsive

- Below `sm`: the centered page title is hidden (`hidden sm:block`); only logo,
  GitHub link, and account dropdown render, with reduced gaps (`gap-2`).
- At `sm` and up the full row (title centered, `gap-3`) matches desktop.

## Behavior

- Account trigger: ghost icon Button wrapping an Avatar with fallback "G" (no auth; guest).
- Glass dropdown (align end, backdrop blur): header block (avatar + guest name/email line),
  a Language row reusing the LocaleSwitcher pill, then History and Settings items.
- History / Settings items open the centered settings dialog at the matching pane
  (onSelect preventDefault so the menu state survives the dialog opening).
- Seam status chip (first item in the right cluster, before the locale
  switcher): a dot + label driven by `$seamHealth` (lib/seam-health.ts),
  aggregating the three voice seams — stt, tts, llm. All up renders a bare
  green dot on seamless chrome; exactly one down is an orange dot with a
  persimmon/butter tint naming the layer (`stt down` / `tts down` /
  `llm down`); two or more down reads `unstable` with the same tint; all
  three down is a red dot + red tint reading `offline`. It is an
  indicator, not a control — clicking opens settings -> status, the
  hidden pane that explains each seam's state and hosts the prefilled
  github "report issue" link.
