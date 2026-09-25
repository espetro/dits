# Screen: Navbar (shared AppHeader)

Mounted in `__root` for every route: logo, optional centered page title,
LocaleSwitcher, GitHub link, and the account dropdown (B3).

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
- Runtime mode chip (first item in the right cluster, before the locale
  switcher): a pill showing the EFFECTIVE runtime (server / custom endpoint /
  in-browser). Its dropdown persists the choice to `$runtimeMode`; picking
  `server` re-probes `/api/health`. When the chosen mode fell back (chosen
  server but unreachable), the pill carries a butter-warn tint + pulsing dot
  and the menu shows a runtime.unreachable note — the mode is a user choice,
  never a silent probe result.
