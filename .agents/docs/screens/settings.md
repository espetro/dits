# Screen: Settings dialog (account dropdown, centered)

One centered dialog is the single settings surface, opened from the
account dropdown, the runtime status chip, or any `openSettings(pane)`
call site. Six panes: past interviews, voice & microphone, interviewer
ai, downloads, language, advanced. Desktop: borderless left sidebar nav +
inset rounded content card. Mobile: full-screen with a top pane select.
URL-driven: `?settings=1&pane=…` (pane ∈ history | voice | ai | downloads
| language | advanced; the legacy `aiProvider` value maps to `ai`).

Row grammar everywhere (spotify-style): each row is title + one-line
plain-language description + right control, built on the vendored
Item/Select/Collapsible/Alert/Progress/Empty blocks. Plain words in
titles ("understands you with", not "stt"); technical terms (endpoint,
runtime, api flavor) only appear in the advanced pane.

## ASCII mockup (desktop, default)

```
                 +------------------------------------------------------------------+
                 |                                             [x]                  |
                 |  +------------------+  +---------------------------------+       |
                 |  |  (w-60, p-5)     |  |  VOICE & MICROPHONE  (card)     |       |
                 |  |                  |  |  ---------------------------------      |
                 |  |  [x] close       |  |   large title + hairline rule   |       |
                 |  |  (own block)     |  |                                 |       |
                 |  |                  |  |  microphone            [select] |       |
                 |  |  -------------   |  |  understands you with  [select] |       |
                 |  |  o past          |  |  answers you with      [select] |       |
                 |  |    interviews    |  |  on-device voice pack  st [go>] |       |
                 |  |  o voice & mic   |  |  test call             [button] |       |
                 |  |    (active)      |  |   <- centered max-w-xl column -> |       |
                 |  |  o interviewer ai|  |                                 |       |
                 |  |  o downloads     |  |                                 |       |
                 |  |  o language      |  |                                 |       |
                 |  |  o advanced      |  |                                 |       |
                 |  +------------------+  +---------------------------------+       |
                 +------------------------------------------------------------------+
                    sm:max-w-4xl lg:max-w-5xl, h-[min(40rem,100vh-6rem)];
                    sidebar has NO border; card has border + shadow,
                    inset my-3 mr-3 so the borders never touch
```

## ASCII mockup (mobile, 375px)

```
        +---------------------------+
        | [pane select v]      [x]  |   <- top bar: pane Select + close
        +---------------------------+
        |  microphone      [select] |
        |  understands you [select] |
        |  answers you     [select] |
        |  on-device pack  st [go>] |
        |  test call      [button]  |
        |                           |
        +---------------------------+
        full-screen: no rounding, no card chrome, no centered column,
        content scrolls; fields stretch full width
```

## Behavior

- Desktop: sm:max-w-4xl lg:max-w-5xl flex-row panel, height
  h-[min(40rem,calc(100vh-6rem))] (rounded-2xl, p-0, shadow-2xl).
  Left sidebar (w-60, p-5): close button in its own top block (pb-5),
  then nav rows in a gap-y-1 column; a separator splits "past
  interviews" (user data) from the configuration panes. Active row
  bg-accent, hover bg-muted/60. Right pane: inset card (my-3 mr-3,
  rounded-xl, border, bg-card, shadow-sm), overflow-y-auto; content is
  a centered max-w-xl column (max-w-2xl for history) under a large
  display heading with border-b hairline. The advanced pane heading
  adds the "most people never need this" note.
- Mobile: full-screen override (inset-0 h-svh w-screen, no rounding)
  via useIsMobile; the sidebar collapses to a top pane Select plus a
  close button; content scrolls with no card chrome.
- URL-driven (raw query string, not validateSearch: the prerender
  server canonicalizes `/?settings=1` to `/` before hydration).
  openSettings/clearSettings in settings-nav.ts pushState + popstate;
  unknown or missing pane falls back to `history`.
- Past interviews pane: client-only OPFS list via listClientSessions
  (Empty block when none), rows link to /interview/$id, /finish/$id or
  /report/$id by status, plus a two-step "clear all" footer that wipes
  every saved session via clearClientSessions.
- Voice & microphone pane: mic picker (MicSelector, `di.devices.mic`),
  "understands you with" stt select (on this device | browser
  built-in), "answers you with" tts select (+ "your own service" only
  when profile.tts exists), a models status row (installed size /
  downloading % / not downloaded / failed) linking to downloads, and a
  test call row that says hello through the resolved tts engine then
  runs a read-aloud stt capture for the mic check. Picks persist to
  `di.voice.sttEngine`/`di.voice.ttsEngine`.
- Consent is point-of-need, never silent: `requestVoiceConsent()` arms
  the root-mounted VoiceConsentDialog via the `$voiceConsentPrompt`
  atom. It fires on first browser-mode interview entry (consent unset)
  and again whenever an on-device engine is picked while consent is not
  granted; accept grants + starts the ~50 mb download, decline writes
  "declined" and the voice pane shows "using browser built-in — switch
  anytime", dismissing leaves consent unset so the next point-of-need
  re-asks.
- Interviewer ai pane: radio pick — demo (recommended badge, gated on
  VITE_DEMO_LLM_*), your own ai account, on this device (experimental
  badge). "own account" reveals the endpoint fields inline (base url,
  api key redacted when saved, model with /models datalist, flavor) and
  an incomplete-config alert when fields are missing; "on this device"
  mounts the browser llm manager (Gemini Nano status dot, transformers
  catalog download/delete) with the WebGPU warning; each branch has a
  test row.
- Downloads pane: every model cache in one place — the on-device voice
  pack (status, size, re-download, remove via clearVoiceModels) and the
  in-browser llm entries (Gemini Nano is Chrome-managed, so status only;
  each transformers catalog model gets download + remove, plus remove
  all).
- Language pane: app language select (drives the url locale prefix via
  a full navigation) and the interview language (new sessions start
  with `di.interview-language`, kept in sync with $draft.language).
- Advanced pane ("most people never need this"): runtime mode select
  (desktop app / browser + custom endpoints / this browser; a degraded
  server pick shows the "server unreachable — using {fallback}" note),
  the llm api flavor select, and collapsible custom-endpoint sections
  for speech-to-text and text-to-speech (builtin vs endpoint toggle,
  endpoint fields, per-section test).
- Saving is automatic: every pane edits a shared SectionDraft context
  (SettingsDraftsProvider inside the dialog so pane switches keep
  in-flight edits); valid drafts write to $providerProfile after a
  600ms debounce, an enabled-but-incomplete llm draft never overwrites
  the last valid profile, and a save rebuilds the browser voice driver
  so the new endpoint takes effect live.
- Pane failures render keyed `errors.*` copy, not raw exception text:
  driver and api errors carry a `code` that maps to a locale key
  (`errorDetail`/`codeMessage` in `lib/errors.ts`).
- Runtime chip is a status indicator, not a control: it shows the
  effective runtime (tinted persimmon when the server pick degraded to
  a browser mode) and opens settings -> advanced on click. The old
  three-way voice taxonomy (voice pane pickers + aiProvider in-browser
  |custom + the chip dropdown) is gone — resolveVoiceEngines() stays
  the single arbitrator behind the two plain picks.
- Tests (unchanged semantics): per-section Test uses the same client
  guards — empty fields rejected with settings.invalid, ok/failed
  status lines, stt browser test needs SpeechRecognition, tts speaks
  "hello".
- Demo LLM (p2 zero-conf): picking demo fills the managed endpoint
  (VITE_DEMO_LLM_* at build time, url never committed, placeholder
  apiKey); switching to "own account" blanks the managed fields so real
  values are entered.
