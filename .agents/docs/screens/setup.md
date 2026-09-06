# Screen: Setup (`/{-$locale}/setup`)

## ASCII mockup

```
+------------------------------------------------------------------+
|  [logo di]                 configure interview          history   |
+------------------------------------------------------------------+
|                                                                  |
|  PRESETS                                                         |
|  ( (sys design) (behavioral) (frontend) (ML) (custom) )          |
|                                                                  |
|  CUSTOM PROMPT                                                   |
|  +----------------------------------------------------------+   |
|  | textarea: paste a job description, your resume context,  |   |
|  | or anything the agent should know about                  |   |
|  +----------------------------------------------------------+   |
|                                                                  |
|  FILES (text-only: pdf, md, txt, docx — 10 files / 20MB max)     |
|  +----------------------------------------------------------+   |
|  |  [drop files or click to browse]                         |   |
|  +----------------------------------------------------------+   |
|  ( resume.pdf 24kB x ) ( jd.md 2kB x )                           |
|                                                                  |
|  FORM                                                            |
|  duration: (20) (30) (45) (60) min                               |
|  tone:     [dropdown]     difficulty: [dropdown]                 |
|  language: [dropdown]     mode:  (interview) (coach*)            |
|                                                                  |
|              +-----------------------------+                     |
|              |        start interview      |  => /validate/[id]  |
|              +-----------------------------+                     |
|              proceed without validation => /interview/[id]       |
|                                                                  |
+------------------------------------------------------------------+
```

## Behavior

- Preset scenario chips fill the custom-prompt textarea with canned content; selecting a preset is just a textarea pre-fill.
- File drop: functional since M3. Files upload to `POST /v1/sessions/:id/documents`
  right after session creation (before navigating away). Text-only: pdf, md, txt,
  docx. Caps enforced client- and server-side (10 files / 20MB total) with inline
  error copy; bad-type and cap violations never navigate. Files are listed under
  the drop zone with size and a remove control. Upload failure shows an error but
  does not block starting the interview.
- Mic selector: ElevenLabs UI `mic-selector` registry component
  (`web/src/components/vendor/mic-selector.tsx`, with `live-waveform.tsx`)
  between files and the form, wrapped in a `data-testid="mic-check"` element.
  Device list populates without permission (labels fallback to "Microphone
  <id>"); opening the dropdown requests getUserMedia to resolve real labels.
  Mute toggle and live waveform preview appear in the dropdown footer while
  open. Not gated: the start buttons do not depend on mic state. The
  component renders built-in English strings (no i18n hooks). Nothing is
  recorded or transmitted; preview capture stops when the dropdown closes.
- Form fields: duration (20/30/45/60), tone, difficulty, language (interview language, NOT the UI locale), mode (`interview|coach`).
- Primary action **start interview** (setup.validate) creates the session
  (POST /v1/sessions) then routes to `/validate/[id]`. Design: espresso pill,
  semibold base-size text, lucide ArrowRight that slides right on hover,
  persimmon hover with soft shadow lift, active scale 0.97 (replaces the old
  oversized "validate & start →" text-arrow pill).
- Link **proceed without validation** routes straight to `/interview/[id]`.
- Coach mode button is disabled but animated, with an explanatory tooltip ("available after your first report") until a report exists.

- The provider profile form and the runtime selector moved out of setup into
  the settings dialog's AI provider pane (B4). When the effective runtime is
  not `server` and no profile with an llm section exists, setup shows a muted
  notice (setup.needsProvider) with a button that opens the settings dialog at
  the AI provider pane.
- Failure feedback: `start()` wraps session creation in try/catch. On failure
  it re-probes the server; if unreachable it raises a sonner toast
  (setup.startFailedToast with setup.needsProvider as description), otherwise
  an inline error. This covers the static-host 405 case: reachability is
  re-probed on mount whenever it is not freshly confirmed false, so a stale
  persisted "reachable" value can no longer pin the runtime to `server` and
  silently swallow the click.

- **Custom runtime** (ADR-0003, `$effectiveRuntime !== "server"`):
  the start action creates the session via `web/src/lib/opfs-store.ts#createClientSession`
  instead of `POST /v1/sessions`, and skips `uploadDocuments` entirely — no
  ingestion pipeline exists client-side, so files picked in this mode are
  accepted by the widget but never sent anywhere. It also calls
  `resetClientSession()` first so a new session never inherits turns/question
  state left over from a previous client-only interview in the same tab.

## Responsive

- Mobile-first: base styles fit 375px. Preset chips, duration pills and mode
  pills wrap (`flex-wrap`); the file dropzone reduces padding on mobile
  (`p-6 md:p-8`); file rows use `min-w-0` + `truncate` so long names never
  overflow. Desktop layout is unchanged.

## URL / state

- Heading structure: the page's single `h1` is the localized "configure
  interview" title rendered in the shared app header (`AppHeaderSlot` in
  `web/src/routes/__root.tsx`); section labels on the page itself are `h2`.
- Optional locale prefix: `/setup` (en) or `/es/setup`, ... — the prefix is the i18n source of truth.
- No URL params on entry. On submit, the created session id drives the next route.
- Form state is local + valibot schema (`CreateSessionRequest` from `@di/shared` via formisch).
