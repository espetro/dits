# Screen: Settings dialog (account dropdown, centered)

Centered dialog opened from the account dropdown (B3). Two panes:
History ("previous sessions") and AI Provider. Desktop: borderless left
sidebar nav + inset rounded content card (ChatGPT-style). Mobile:
full-screen with a top tab bar. URL-driven: `?settings=1&pane=…`.

## ASCII mockup (desktop, default)

```
                 +------------------------------------------------+
                 |                                    x           |
                 |  +----------------+  +-----------------------+ |
                 |  | (no border)    |  |  AI PROVIDER  (card)  | |
                 |  | o previous     |  |                       | |
                 |  |   sessions     |  |  [STT] [TTS] [LLM]    | |
                 |  |                |  |  +-----------------+  | |
                 |  | o AI provider  |  |  | (o) in-browser  |  | |  <- LLM: built-in
                 |  |   (active)     |  |  | (*) custom      |  | |     radio disabled;
                 |  |                |  |  |                 |  | |     defaults to custom
                 |  |  hover pill    |  |  | helper text     |  | |
                 |  |  contains      |  |  | base url [____] |  | |
                 |  |  truncated     |  |  | api key  [____] |  | |
                 |  |  label         |  |  | model    [____] |  | |
                 |  |                |  |  | free providers  |  | |  <- clickable links
                 |  |                |  |  | (openrouter...) |  | |
                 |  |                |  |  | [Test] [Save]   |  | |  <- spinner/ok/fail
                 |  +----------------+  +-----------------------+ |     + saved indicator
                 +------------------------------------------------+
                    sidebar has NO border; card has border + shadow,
                    inset my-3 mr-3 so the borders never touch
```

## ASCII mockup (mobile, 375px)

```
        +---------------------------+
        | [o prev sessions][AI prov]|   <- top tab bar, 2 tabs,
        +---------------------------+      full-width flex-1
        |  [STT]  [TTS]  [LLM]      |   <- sub-tabs (pill list)
        |  (o) in-browser           |
        |  (*) custom endpoint      |
        |  helper text (muted)      |
        |  base url [___________]   |
        |  api key  [___________]   |
        |  model    [___________]   |
        |  free provider links      |
        |  [Test]      [Save]       |   <- footer stacks vertically
        |                           |
        +---------------------------+
        full-screen: no rounding, no card chrome, content scrolls
```

## Behavior

- Desktop: max-w-3xl flex-row panel (rounded-2xl, p-0, shadow-2xl).
  Left sidebar (w-48, p-3): History + AI Provider ghost buttons, no
  border; active row bg-accent, hover bg-muted/60; label span is
  truncate + min-w-0 so the hover pill always contains it.
  Right pane: inset card (my-3 mr-3, rounded-xl, border, bg-card,
  shadow-sm), overflow-y-auto — sidebar and card borders never touch.
- Mobile: full-screen override (inset-0 h-svh w-screen, no rounding,
  close button hidden) via useIsMobile media-query hook. The sidebar is
  replaced by a top tab bar (shadcn Tabs, flex-1 triggers, icon +
  label); content scrolls with overflow-y-auto and drops the card
  chrome to fit 375px. Footer rows wrap: flex-col gap-2 sm:flex-row.
- URL-driven (raw query string, not validateSearch: the prerender
  server canonicalizes `/?settings=1` to `/` before hydration).
  openSettings/clearSettings pushState + popstate; unknown or missing
  pane falls back to `history` (the old empty "settings" pane was
  removed, along with its user-dropdown entry).
- History pane: client-only load from OPFS via listClientSessions in
  useEffect (SSR renders "..." then rows or the history.empty empty
  state). Rows link to /interview/$id, /finish/$id or /report/$id by
  status, with a status chip and relative date.
- AI Provider pane: three sub-tabs STT / TTS / LLM. Each chooses
  In-browser (Web Speech fallback; radio disabled for LLM) vs Custom
  endpoint (baseUrl, apiKey redacted when saved via redactKey, model,
  voice for TTS). LLM defaults to custom (llmRequired helper always
  shown there). STT/TTS custom mode shows the settings.customProviders
  helper (whisper.cpp/Speaches for STT, Piper/Kokoro for TTS) and a
  FreeProviderLinks row (OpenRouter, Groq, Cerebras, Google AI Studio;
  target=_blank rel=noreferrer).
- Test button: disabled while running (Loader2 spinner +
  settings.testing), client-side guard rejects empty fields with
  settings.invalid instead of a false ok; result is a check "Working"
  or "Failed: {message}" line (role=status) that auto-clears after 4s.
  LLM runs a tiny streamed completion, TTS synthesizes a phrase, STT
  probes ${base}/v1/models. In-browser STT/TTS (custom endpoint off)
  the Test button stays enabled when the browser exposes the Web
  Speech feature (STT: SpeechRecognition; TTS: speechSynthesis):
  STT starts recognition for ~3s and reports ok on audio events, TTS
  speaks "hello" and resolves on `end` (5s timeout fallback). When the
  browser lacks the feature the button is disabled with a muted
  settings.test.unsupported reason line (role=note) and a matching
  title tooltip.
- Save: validates with ProviderSectionsSchema (LLM required), sets
  $providerProfile, shows inline "Saved." (role=status) that
  auto-clears after 3s; editing a field resets it.
