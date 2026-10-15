# Screen: Settings dialog (account dropdown, centered)

One centered dialog is the single settings surface, opened from the
account dropdown, the navbar status chip, or any `openSettings(pane)`
call site. Four nav panes — past interviews, user preferences, voice &
personality, data (danger zone, separated by a rule) — plus a hidden system-status view the chip opens
(pane=status). Desktop: borderless left sidebar nav + inset rounded
content card. Mobile: full-screen with a top pane select. URL-driven:
`?settings=1&pane=…` (pane ∈ history | preferences | voice | data | status;
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

Each layer section (stt, llm, tts) is one `data-testid="layer-test-{stt|llm|tts}"`
container holding the layer picker, its config and its Test row. After a test
runs, the container shows a single `role="status"` line: "Working" (plus timing
or route) on success, "Failed: <detail>" on failure. The tts test also toasts
failures. e2e specs scope by that testid and assert the status text.

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
  every saved session via clearClientSessions and, when the di server is
  reachable, DELETE /v1/sessions/:id for each server session (the
  sidecar sqlite is not left behind).
- Data pane: one destructive "reset everything" row inside a
  destructive-bordered block. Opens a dialog with a typed confirmation
  word (locale `settings.data.confirmWord`); on confirm it calls
  DELETE /v1/data when the server is reachable (db rows, builtin model
  cache, log), then clears OPFS sessions, voice model cache, transformers
  cache and every `di.*` / `di:*` localStorage key, and hard-reloads into
  first-run state. Failures render in a destructive alert inside the
  dialog. The desktop shell has a separate control route
  (`POST /api/reset`) that also removes db files, data dir, log and
  config.yaml (keys) and restarts the sidecar.
- User preferences pane: app language select (drives the url locale
  prefix via a full navigation) and the interview language (new
  sessions start with `di.interview-language`, kept in sync with
  $draft.language). Home for future user-wide prefs.
- Voice & personality pane: three sections — Hearing, Brain, Voice.
  Hearing: mic picker (MicSelector, `di.devices.mic`), stt layer
  select (automatic | in-browser | on-device wasm | cloud endpoint;
  desktop app only when the di server is reachable), the layer's
  conditional (one ModelPackFiles block listing a row per model cache
  in play: wasm → on-device pack download/progress/remove — with
  consent granted a missing pack auto-downloads; server-effective →
  "di server {kind}" row managing files.data_dir/models via
  /v1/voice/models — the row also stays while a stale cache of that
  location holds files; cloud →
  stt endpoint fields; explicit server while unreachable → warn note),
  and the test row: capture the selected mic through the resolved
  layer (builtin live stt, or capture→engine feed→flush for
  wasm/endpoint), live waveform + recognized text. Brain: interviewer
  model select (in-browser disabled "coming soon" | demo | cloud;
  demo is the default and fills the managed VITE_DEMO_LLM_* endpoint;
  in-browser renders the future options — gemini nano + transformers
  catalog — marked unavailable, no fake engine), cloud reveals the
  endpoint fields (a provider preset select above the base url, fed by
  PROVIDER_PRESETS from @di/shared: picking a preset fills its
  authoritative version path, "Custom" clears it, an unmatched url reads
  as Custom; hidden for the demo endpoint and anthropic flavor; same on
  the stt and tts endpoint fields; base url, api key masked inside a <form> with a
  show/hide toggle — the saved-key placeholder is redactKey-masked,
  never raw, model combobox, free-provider callout) plus an
  incomplete alert; the test row streams a
  real one-word completion into a read-only textarea. Test is never
  disabled by incomplete fields: it re-probes the di server first, then
  reports a precise localized reason (missing or invalid base url, missing
  model id, unreachable endpoint per route, http status with upstream
  detail, in-band sse error, 30s timeout, empty stream) and always names
  the route it took ("via di server relay" or "browser direct").
  A stream that carried reasoning but no visible text counts as working
  with a note. The anthropic flavor posts native `/v1/messages` with
  x-api-key straight from the browser (the relay forwards only
  authorization). The llm test builds its model through the llm slice
  factory (createLlmModel), and the stt and tts endpoint calls use the
  same relay-or-direct fetch as the llm.
  The base url is authoritative: only trailing slashes are trimmed, then
  `/models` and `/chat/completions` are appended; no `/v1` is stripped
  or injected (zAI `/v4`, google `/v1beta/openai`, openrouter `/api/v1`).
  The model combobox (model-combobox.tsx, used on the llm, stt and tts
  tabs) probes `${base}/models` once the
  section is enabled and a base url parses (600ms debounce, re-run when
  the server probe settles; the model field always stays free-text).
  Focus or the chevron opens a positioned listbox with every model
  (unfiltered until the user types), arrow keys, enter and escape;
  loading, empty, no-match and error states render inside the list.
  A failed probe renders its reason in the list and under the model field (http status,
  "not a model list", "network or CORS", unexpected shape) and, for html
  or 404 answers, suggests a base url candidate (`/v1`, `/v4`,
  `/api/v1`) that does serve JSON; the hint is never applied silently.
  Probes go through the server relay (`/v1/relay`) when the di server is
  reachable, so keyless gateways (bifrost) and CORS-hostile
  endpoints (openrouter) still populate; browser-direct on the
  public site build, which requires a CORS-enabled endpoint. Voice: tts
  layer select mirroring Hearing (same ModelPackFiles block —
  wasm → device pack row, server → di-server pack row — cloud → tts
  endpoint fields) and the test row that synthesizes the localized
  test phrase into a minimal audio player (play/stop + linear
  progress; speechSynthesis gets an estimated bar) with the measured
  synth time ("{ms} ms") beside it. When the server drives tts the test
  posts `POST /v1/voice/tts-test` so the configured server layer
  (builtin kitten or remote endpoint) is the one measured; the in-browser
  layer fails loudly when speechSynthesis or its voices are missing, and
  a rejected `play()` surfaces as an error toast instead of silence.
  Setting rows wrap their control under the text below ~48 rem of
  content width rather than squeezing the player. Picks persist to
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
  Install state lives in the persisted `di.voice.modelsInstalled`
  flag (written on download/clear, re-verified against the cache on
  load/consent/wasm pick) — pane and chip read the same verdict.
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
  in-flight edits); drafts hydrate once from the first real
  $providerProfile value (the ssr store yields null pre-mount — a
  typed edit cancels hydration so nothing clobbers it); valid drafts
  write to $providerProfile after a 600ms debounce, an
  enabled-but-incomplete llm draft never overwrites the last valid
  profile, and a save rebuilds the browser voice driver so the new
  endpoint takes effect live.
- Pane failures render keyed `errors.*` copy, not raw exception text:
  driver and api errors carry a `code` that maps to a locale key
  (`errorDetail`/`codeMessage` in `lib/errors.ts`).
- Navbar status chip: a seam-health indicator, not a control — all
  seams up shows a bare green dot on navbar-colored chrome; one seam
  down an orange dot + tint naming the layer ("stt down"), two "unstable",
  all three a red "offline". Clicking opens pane=status. Health comes
  from lib/seam-health.ts: configuration resolution (pick unsupported /
  unreachable / unconfigured — the wasm "missing download" verdict
  reads `di.voice.modelsInstalled`) + last-op outcomes (voice health
  events, driver onError codes, llm turn results), cleared on next
  success.
- Tests (per layer): the test row is always rendered for stt, tts and
  llm, whatever layer is picked. stt test runs the resolved engine on a
  ~12s mic window (builtin read-aloud or capture→flush for
  wasm/endpoint); when the di server drives stt (auto or "server") it
  records ~6s from the selected mic, converts it to a 16k mono pcm16
  wav and posts `POST /v1/voice/stt-test` (wav, or raw `audio/L16`), so
  the configured server layer (builtin sherpa or remote whisper)
  transcribes it; the recognized text, the server-measured "{ms} ms"
  and the ok/failed status render like the other paths, with typed
  errors (`stt_model_missing` 409, `stt_failed` 502 carrying the
  upstream detail). llm test streams a short completion; tts test really synthesizes
  and plays — never a file-presence check.
- Demo LLM (p2 zero-conf): demo is the default interviewer pick and
  fills the managed endpoint (VITE_DEMO_LLM_* at build time, url never
  committed, placeholder apiKey); switching to cloud blanks the managed
  fields so real values are entered. The demo callout states the shared/
  rate-limited limits.
