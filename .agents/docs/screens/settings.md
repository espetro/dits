# Screen: Settings dialog (account dropdown, centered)

One centered dialog is the single settings surface, opened from the
account dropdown, the navbar status chip, or any `openSettings(pane)`
call site. Three nav panes — past interviews, user preferences, voice &
personality — plus a hidden system-status view the chip opens
(pane=status). Desktop: borderless left sidebar nav + inset rounded
content card. Mobile: full-screen with a top pane select. URL-driven:
`?settings=1&pane=…` (pane ∈ history | preferences | voice | status;
legacy ids — `ai`, `downloads`, `advanced`, `aiProvider` → voice;
`language` → preferences).

Row grammar everywhere (spotify-style): each row is title + one-line
plain-language description + right control, built on the vendored
Item/Select/Alert/Progress/Empty blocks. Every interview layer is
individually configurable — the old global "runtime mode" is gone;
driver selection derives from the resolved stt+tts layers
(lib/voice/index.ts): the server driver runs only when both layers ask
for it (server pick or auto + reachable /api/health), the browser
driver otherwise.

## ASCII mockup (desktop, default)

```
                 +------------------------------------------------------------------+
                 |                                             [x]                  |
                 |  +------------------+  +---------------------------------+       |
                 |  |  (w-60, p-5)     |  |  VOICE & PERSONALITY  (card)    |       |
                 |  |                  |  |  ---------------------------------      |
                 |  |  [x] close       |  |   large title + hairline rule   |       |
                 |  |  (own block)     |  |                                 |       |
                 |  |                  |  |  ~ hearing ~                    |       |
                 |  |  -------------   |  |  microphone            [select] |       |
                 |  |  o past          |  |  stt layer             [select] |       |
                 |  |    interviews    |  |  (layer conditional: pack|ep)   |       |
                 |  |  o user          |  |  test     [button] ~wave~ [text]|       |
                 |  |    preferences   |  |  ~ brain ~                      |       |
                 |  |  o voice &       |  |  interviewer model     [select] |       |
                 |  |    personality   |  |  (demo callout | endpoint ui)   |       |
                 |  |    (active)      |  |  test     [button] [textarea]   |       |
                 |  |                  |  |  ~ voice ~                      |       |
                 |  |                  |  |  tts layer             [select] |       |
                 |  |                  |  |  test     [button] [> ||-----]  |       |
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
        | ~ hearing ~               |
        |  microphone      [select] |
        |  stt layer       [select] |
        |  test     [button] ~wave~ |
        | ~ brain ~                 |
        |  interviewer m.  [select] |
        | ~ voice ~                 |
        |  tts layer       [select] |
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
  display heading with border-b hairline.
- Mobile: full-screen override (inset-0 h-svh w-screen, no rounding)
  via useIsMobile; the sidebar collapses to a top pane Select plus a
  close button; content scrolls with no card chrome. The status pane
  is reachable via the chip even though it is not in the nav/select.
- URL-driven (raw query string, not validateSearch: the prerender
  server canonicalizes `/?settings=1` to `/` before hydration).
  openSettings/clearSettings in settings-nav.ts pushState + popstate;
  unknown or missing pane falls back to `history`.
- Past interviews pane: client-only OPFS list via listClientSessions
  (Empty block when none), rows link to /interview/$id, /finish/$id or
  /report/$id by status, plus a two-step "clear all" footer that wipes
  every saved session via clearClientSessions.
- User preferences pane: app language select (drives the url locale
  prefix via a full navigation) and the interview language (new
  sessions start with `di.interview-language`, kept in sync with
  $draft.language). Home for future user-wide prefs.
- Voice & personality pane: three sections — Hearing, Brain, Voice.
  Hearing: mic picker (MicSelector, `di.devices.mic`), stt layer
  select (automatic | in-browser | on-device wasm | cloud endpoint;
  desktop app only when the di server is reachable), the layer's
  conditional (wasm → voice-pack download/progress/remove — with
  consent granted a missing pack auto-downloads; cloud →
  stt endpoint fields; explicit server while unreachable → warn note),
  and the test row: capture the selected mic through the resolved
  layer (builtin live stt, or capture→engine feed→flush for
  wasm/endpoint), live waveform + recognized text. Brain: interviewer
  model select (in-browser disabled "coming soon" | demo | cloud;
  demo is the default and fills the managed VITE_DEMO_LLM_* endpoint;
  in-browser renders the future options — gemini nano + transformers
  catalog — marked unavailable, no fake engine), cloud reveals the
  endpoint fields (base url, api key masked inside a <form> with a
  show/hide toggle, model datalist, free-provider callout) plus an
  incomplete alert; the test row streams a
  real one-word completion into a read-only textarea. Voice: tts
  layer select mirroring Hearing (wasm → pack files, cloud → tts
  endpoint fields) and the test row that synthesizes the localized
  test phrase into a minimal audio player (play/stop + linear
  progress; speechSynthesis gets an estimated bar). Picks persist to
  `di.voice.sttEngine`/`di.voice.ttsEngine`; a stored `di.runtime-mode`
  migrates once ("server" → both layers "server").
- Consent is point-of-need, never silent: `requestVoiceConsent()` arms
  the root-mounted VoiceConsentDialog via `$voiceConsentPrompt`. It
  fires on first browser-mode interview entry (consent unset) and
  whenever a wasm layer is picked while consent is not granted;
  accept grants + starts the ~50 mb download, decline writes
  "declined" and the layer shows the consent-declined note. A wasm
  pick with consent already granted also fetches the pack itself
  (VoicePackFiles effect) — concurrent mounts share one download.
  Switching a layer pick resets that section's test state (stale
  clip/output/playback dropped).
- System status view (hidden, chip-only): one row per seam (stt /
  tts / llm) with up/down, the reason it is down (unreachable server,
  unsupported browser, missing download, unconfigured endpoint, no
  llm, last-op error) and a "fix in voice" action; plus the report-
  issue button that opens a prefilled github issue (title placeholder
  - fenced diagnostics block: user agent, resolved engines, seam
    statuses, last ~20 health events) via `reportIssueUrl()`.
- Saving is automatic: every pane edits a shared SectionDraft context
  (SettingsDraftsProvider inside the dialog so pane switches keep
  in-flight edits); valid drafts write to $providerProfile after a
  600ms debounce, an enabled-but-incomplete llm draft never overwrites
  the last valid profile, and a save rebuilds the browser voice driver
  so the new endpoint takes effect live.
- Pane failures render keyed `errors.*` copy, not raw exception text:
  driver and api errors carry a `code` that maps to a locale key
  (`errorDetail`/`codeMessage` in `lib/errors.ts`).
- Navbar status chip: a seam-health indicator, not a control — all
  seams up shows a bare green dot on navbar-colored chrome; one seam
  down an orange dot + tint naming the layer ("stt down"), two "unstable",
  all three a red "offline". Clicking opens pane=status. Health comes
  from lib/seam-health.ts: configuration resolution (pick unsupported /
  unreachable / unconfigured) + last-op outcomes (voice health events,
  driver onError codes, llm turn results), cleared on next success.
- Tests (per layer): stt test runs the resolved engine on a ~12s mic
  window (builtin read-aloud or capture→flush for wasm/endpoint);
  llm test streams a short completion; tts test really synthesizes
  and plays — never a file-presence check.
- Demo LLM (p2 zero-conf): demo is the default interviewer pick and
  fills the managed endpoint (VITE_DEMO_LLM_* at build time, url never
  committed, placeholder apiKey); switching to cloud blanks the managed
  fields so real values are entered. The demo callout states the shared/
  rate-limited limits.
