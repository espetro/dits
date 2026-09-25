# Screen: Setup (`/{-$locale}/setup`)

> p3 restructure: presets become scenario cards (narrative + goals +
> toolset preview + start CTA); knobs collapse into an advanced section.

## ASCII mockup

```
+------------------------------------------------------------------+
|  [logo di]                 configure interview          history   |
+------------------------------------------------------------------+
|                                                                  |
|  pick a scenario                                                 |
|                                                                  |
|  +---------------------+  +---------------------+  +-----------+ |
|  | sys design          |  | behavioral          |  | frontend  | |
|  | scale a service     |  | STAR stories with   |  | dom, css, | |
|  | under pressure      |  | follow-ups          |  | react     | |
|  | - requirements      |  | - conflict story    |  | - layout  | |
|  | - capacity math     |  | - ownership         |  | - a11y    | |
|  | - trade-offs        |  | - failure           |  | - perf    | |
|  | tools: editor wb    |  | tools: editor       |  | tools: ed | |
|  |      [start ->]     |  |      [start ->]     |  |  [start>] | |
|  +---------------------+  +---------------------+  +-----------+ |
|  +---------------------+  +---------------------+                 |
|  | ML                  |  | custom              |                 |
|  | ...                 |  | bring your own      |                 |
|  |                     |  | prompt              |                 |
|  |                     |  |      [start ->]     |                 |
|  +---------------------+  +---------------------+                 |
|                                                                  |
|  +----------------------------------------------------------+   |
|  | custom prompt (fills from card, editable)                |   |
|  +----------------------------------------------------------+   |
|                                                                  |
|  > advanced options  (duration 30 | tone | difficulty |          |
|                       language | mode | files | mic)             |
|                                                                  |
+------------------------------------------------------------------+
```

## Behavior

- **Scenario cards**: one card per preset (`sys design`, `behavioral`,
  `frontend`, `ML`, `custom`). A card carries a one-line narrative, a 3-item
  goal checklist (what the interviewer will probe), a toolset preview chip
  row (which dock tools the session starts with — seeds `session.tools`),
  and its own **start** CTA. Clicking a card also fills the custom-prompt
  textarea with the preset text (editable before starting).
- **Advanced options** disclosure (collapsed by default, chevron): duration
  (20/30/45/60), tone, difficulty, language, mode (`interview|coach`), the
  FILES dropzone, and the mic selector. Defaults are pre-picked so a card's
  start CTA is a zero-knob path.
- **Coach mode** stays in advanced: gated on any session reaching `reported`
  (setup.coachHint tooltip + inline hint while locked).
- Custom prompt textarea stays visible above advanced — it is the shared
  context field, filled by whichever card was last clicked.
- File dropzone (advanced): `POST /v1/sessions/:id/documents` right after
  session creation; pdf/md/txt/docx, 10 files / 20MB caps enforced client-
  and server-side; upload failure never blocks the start.
- Mic selector (advanced): ElevenLabs `mic-selector` registry component in a
  `data-testid="mic-check"` element; device list without permission, real
  labels on open, live waveform preview. Never gates the start CTA.
- Card **start** creates the session (`POST /v1/sessions` or OPFS in
  client-only) and routes straight to `/interview/[id]` — the validate step
  remains reachable via advanced (`start with plan check` link) but is no
  longer the default path.
- Failure feedback unchanged: `start()` re-probes the server on failure,
  sonner toast vs inline error; static-host 405 handled by the reachability
  re-probe.
- **Custom runtime**: sessions via `createClientSession`, `FILES` section
  inside advanced renders the setup.filesServerOnly hint, and
  `resetClientSession()` runs before a new session. When no llm profile
  exists the setup.needsProvider notice with the settings-dialog button
  still renders above the cards.

## Responsive

- Mobile-first: cards stack single-column at base, `sm:grid-cols-2`,
  `lg:grid-cols-3`. Card CTAs and disclosure targets are `>= 44px`.
- Advanced disclosure content wraps (`flex-wrap`); dropzone reduces padding
  on mobile (`p-6 md:p-8`); file rows `min-w-0` + `truncate`.

## URL / state

- Heading structure: the page's single `h1` is the localized "configure
  interview" title in the shared app header; section labels are `h2`.
- Optional locale prefix: `/setup` (en) or `/es/setup`, ...
- No URL params on entry. On submit, the created session id drives the next
  route (`/interview/[id]` by default, `/validate/[id]` via advanced).
- Form state is local + valibot (`CreateSessionRequest` from `@di/shared`
  via formisch), plus the selected card's toolset written into the session.
