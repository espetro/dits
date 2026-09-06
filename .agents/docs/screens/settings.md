# Screen: Settings dialog (account dropdown, centered)

Centered dialog opened from the account dropdown (B3). Two panes:
History ("previous sessions") and AI Provider. Desktop: borderless left
sidebar nav + inset rounded content card (ChatGPT-style). Mobile:
full-screen with a top tab bar. URL-driven: `?settings=1&pane=…`.

## ASCII mockup (desktop, default)

ElevenMusic-style geometry: wide dialog, w-60 sidebar with the close
button in its own block, inset card with a centered max-w-xl column.

```
                 +------------------------------------------------------------------+
                 |                                             [x]                  |
                 |  +------------------+  +---------------------------------+       |
                 |  |  (w-60, p-5)     |  |  AI PROVIDER        (card)      |       |
                 |  |                  |  |  ---------------------------------      |
                 |  |  [x] close       |  |   large title + hairline rule   |       |
                 |  |  (own block,     |  |                                 |       |
                 |  |   p-5 breathing  |  |  [STT] [TTS] [LLM]              |       |
                 |  |   room above     |  |  +---------------------------+  |       |
                 |  |   nav)           |  |  | (o) in-browser            |  |       |
                 |  |                  |  |  | (*) custom                |  |       |
                 |  | o previous       |  |  +---------------------------+  |       |
                 |  |   sessions       |  |   <- centered max-w-xl column -> |       |
                 |  |                  |  |  base url [_________]           |       |
                 |  | o AI provider    |  |    one-line muted helper        |       |
                 |  |   (active)       |  |  api key  [_________]           |       |
                 |  |                  |  |    one-line muted helper        |       |
                 |  |  rows py-2.5     |  |  model    [_________]           |       |
                 |  |  px-3 (~44px)    |  |    one-line muted helper        |       |
                 |  |  gap-y-1         |  |  free providers (links)         |       |
                 |  |                  |  |  [Test]          [Save]         |       |
                 |  +------------------+  +---------------------------------+       |
                 +------------------------------------------------------------------+
                    sm:max-w-4xl lg:max-w-5xl, h-[min(40rem,100vh-6rem)];
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
        |  base url [___________]   |
        |    one-line muted helper  |
        |  api key  [___________]   |
        |    one-line muted helper  |
        |  model    [___________]   |
        |    one-line muted helper  |
        |  free provider links      |
        |  [Test]      [Save]       |   <- footer stacks vertically
        |                           |
        +---------------------------+
        full-screen: no rounding, no card chrome, no centered column,
        content scrolls; fields stretch full width as before
```

## Behavior

- Desktop: sm:max-w-4xl lg:max-w-5xl flex-row panel, height
  h-[min(40rem,calc(100vh-6rem))] (rounded-2xl, p-0, shadow-2xl).
  Left sidebar (w-60, p-5): close button in its own top block (pb-5)
  with breathing room, then the nav rows in a gap-y-1 column; each row
  is a History / AI Provider ghost button at py-2.5 px-3 (~44px tall),
  no border; active row bg-accent, hover bg-muted/60; label span is
  truncate + min-w-0 so the hover pill always contains it.
  Right pane: inset card (my-3 mr-3, rounded-xl, border, bg-card,
  shadow-sm), overflow-y-auto — sidebar and card borders never touch.
  Inside the card the pane content is wrapped in a centered column:
  max-w-xl mx-auto for AI provider, max-w-2xl mx-auto for history;
  each pane opens with a large display heading over a full-width
  border-b hairline, and section groups sit in space-y-10.
  Endpoint fields render through the SettingsField helper (label +
  input + one-line muted helper, settings.baseUrlHelp / apiKeyHelp /
  modelHelp / voiceHelp). Mobile keeps the pre-existing full-screen
  layout with no centered column.
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
  In-browser vs Custom endpoint (baseUrl, apiKey redacted when saved via
  redactKey, model, voice for TTS). STT in-browser = Web Speech fallback.
  LLM in-browser radio is enabled when the browser has the Prompt API
  (LanguageModel global) or WebGPU; selecting it shows the browser LLM
  manager (see below). LLM custom mode adds a flavor select
  (OpenAI/Anthropic-compatible) above the endpoint fields. STT/TTS custom
  mode shows the settings.customProviders helper (whisper.cpp/Speaches for
  STT, Piper/Kokoro for TTS) and a FreeProviderLinks row (OpenRouter,
  Groq, Cerebras, Google AI Studio; target=_blank rel=noreferrer).
- LLM browser manager: engine select (Gemini Nano | Transformers.js).
  Gemini Nano row shows a status dot (green installed / amber
  downloadable / red unsupported) plus a muted hint; unsupported shows a
  "use Chrome 148+ or Transformers.js" note. Transformers.js lists the
  curated catalog (label + ~size MB + installed chip) as radio rows with
  Download (shows live {percent}% while busy), per-selected-model Delete,
  and Remove all models; weights live in the Cache API, deletion purges
  the matching entries.
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
