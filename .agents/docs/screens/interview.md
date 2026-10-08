# Screen: Interview (`/interview/[id]`)

> w2 restructure: single viewport, no page scroll. AppHeader is suppressed on
> `/interview/*`; a 44px callbar replaces it. Desktop is a two-card grid —
> conversation card (chip -> stage -> transcript -> mic waveform -> composer)
> on the left, workspace card (ToolDock) on the right — plus a floating
> bottom-center control pillbar. Mobile keeps the conversation card only.

## ASCII mockup

```
+------------------------------ desktop (>= md) -----------------------------+
|  di. {session title}              12:34 / 30:00            end interview  |
+---------------------------------------------------------------------------+
| +-- conversation card ------------------+  +-- workspace card ----------+ |
| | [QUESTION 3] [hint chip]  [type hint] |  | [editor] [whiteboard] [+]  | |
| |                                       |  |                            | |
| | ((o)) LISTENING                       |  | TOOL PANE (active tab)     | |
| |  "how would you handle cache          |  |  def solve(nums): ...      | |
| |   invalidation across regions?"       |  |                            | |
| |                                       |  |                            | |
| | agent · voice   so, tell me about...  |  |                            | |
| | user · voice    well, I'd start...    |  |                            | |
| | (transcript scrolls internally)       |  |                            | |
| | -----------------------------------   |  |                            | |
| | ~~~ mic waveform ~~~          you·mic |  |                            | |
| | ( talk or type...                )    |  |                            | |
| +---------------------------------------+  +----------------------------+ |
+----------------------------[ (mic) (kb) (x) ]--- floating pillbar ---------+
|          nothing scrolls at page level — transcript + tools scroll inside |
+---------------------------------------------------------------------------+

+------------------------------ mobile (< md) --------------------------------+
|  di. {title}                                       end interview          |
+---------------------------------------------------------------------------+
| +-- conversation card (fills viewport) ---------------------------------+ |
| | [QUESTION 3] [type hint]                                              | |
| | ((o)) LISTENING  "how would you handle..."                            | |
| | agent · voice   so, tell me about...                                  | |
| | user · voice    well, I'd start...                                    | |
| | ---------------------------                                           | |
| | ~~~ waveform ~~~            you·mic                                   | |
| | ( talk or type... )                                                   | |
| |                                                                       | |
| |          <- ~70px clearance under the composer                        | |
| +-----------------------------------------------------------------------+ |
+----------------------------[ (mic) (kb) (x) ]------------------------------+
+---------------------------------------------------------------------------+
```

## Zones

### CallBar (new, replaces AppHeader on `/interview/*`)

- `__root.tsx` suppresses `AppHeader` for `/interview/` paths; the CallBar is
  the route's own chrome at a fixed `h-11` (44px).
- Left: `di.` logo link + session title (truncates).
- Center: `mm:ss / mm:ss` elapsed/total timer (hidden below `md`), anchored
  to `session.created_at` so a reload keeps real elapsed time; persimmon once
  inside the 2-minute wrap-up, 0 hard-stops to `/finish/[id]`.
- Right: voice-retry button (error only) + `end interview` -> confirm ->
  `/finish/[id]`.

### Conversation card

The left card (`minmax(360px,34%)` of the desktop grid, full width on
mobile) stacks, top to bottom:

- **Question chip row**: `QUESTION n` progress chip (n counts
  `update_question` calls this session), optional agent-attached hint chips,
  and the no-speech type-instead hint when it fires. The structured question
  text itself no longer renders as a card — it lives in the stage caption.
- **AgentStage (compact)**: ~48-56px voice orb (three.js Orb; css gradient
  orb fallback in client-only mode) + uppercase status word + live caption in
  Fraunces, 2-line clamp. Caption = latest agent utterance, falling back to
  the structured `update_question` text, then the preparing copy — during
  user turns the caption holds so the last question stays on screen.
- **Transcript stream**: vendored AI Elements `Conversation` +
  `Message` (`use-stick-to-bottom` replaces the bespoke scroll plumbing).
  Flat `speaker · source` rows, scrolls internally, flex-1.
- **Mic waveform strip**: vendored `LiveWaveform` canvas pinned directly
  above the composer on a `border-t` hairline, `role="img"` + i18n
  aria-label, `you · mic` caption right. `active` while the voice socket is
  connected and unmuted (its own `getUserMedia` renders real mic level);
  `processing` while connecting/reconnecting; flat dotted idle otherwise.
  This also replaces the old 16px pulse-dot client-only fallback — the orb
  now renders a full-size css gradient orb there.
- **Composer**: vendored `PromptInput` + `PromptInputTextarea`, rounded-full,
  pinned at the card bottom. Placeholder `talk or type…`. Enter submits
  (shift+enter newline, IME-safe); uncontrolled — the form resets itself.

### Workspace card

- Right grid column, desktop (`>= md`) only — hidden on mobile.
- `ToolDock` fills the full column height: cream-deep card, pill tab bar
  (active tab = paper pill), paper body pane. `session.tools` order is tab
  order; `>4` tools collapse trailing tabs into a `+` overflow picker; the
  active tab is the `?tool=` search param.
- Dock panes ship per session toolset (`TOOL_REGISTRY`/`TOOL_AGENT_ACCESS`):
  - `editor` (notes): Milkdown markdown notepad + code-block language bar;
    `read_editor` returns the raw markdown.
  - `code` (code notepad): CodeMirror 6 editor — language picker (python,
    js, ts, java, c++, go, rust, sql, json), mono pane, di-palette theme,
    a `syntax error` pill when the lezer parse flags errors. Buffer lives in
    `$codeBuffer`; the pick persists as `di:code:language`. `read_code`
    returns code + a `language`/`syntax` trailer (`ok` / `syntax error(s)` /
    `unchecked (editor closed)`).
  - `whiteboard`: tldraw surface, `read_whiteboard` returns a text snapshot;
    server-only while tldraw is bundled (hidden in client-only mode).

### ControlBar (floating pillbar)

- Fixed bottom-center espresso pill on **every** viewport,
  `role="toolbar"` + i18n aria-label, icons-only lucide buttons (44px) each
  with an i18n aria-label: mute/unmute microphone, switch to typing (focuses
  the composer), end interview (persimmon-deep, X icon).
- `padding-bottom: env(safe-area-inset-bottom)` on the pill; mobile keeps
  ~78px clearance under the conversation card so the pillbar never overlaps
  the composer.

## Behavior

- **Nothing scrolls at page level** on any viewport — only the transcript and
  tool panes scroll internally (`document.scrollHeight <= innerHeight` at
  1440x900 and 390x844).
- Typed turns are unchanged: `PromptInput` submit -> `voice.sendText` (ws
  `{t:"text"}`, same pipeline as speech) when connected or client-only, else
  `POST /v1/sessions/:id/turns` as the degraded-path write.
- **Back-guard**: while the interview is in progress, browser back/close
  fires a confirm (`beforeunload` + router blocker). Inert once ended.
- Voice wiring is unchanged: WebSocket + Web Audio, 16k PCM16 capture, Silero
  VAD (`/vad/` vendored, tuned for interview cadence — 600ms redemption,
  0.5/0.35 hysteresis, 250ms min utterance; all `VITE_VAD_*` overridable),
  `{t:"interrupt"}` barge-in (300ms grace on the browser driver), reconnect
  with backoff, voice->text degradation surfaces the type path immediately.
  - Wasm tts streams pcm chunks as synthesized, so playback starts on the
    first chunk rather than waiting for the whole utterance; the per-sentence
    timeout budgets time-to-first-chunk and abandons via iterator `return()`,
    which cancels the worker-side generator.
  - Browser-mode echo gate (adaptive): while agent audio is queued or
    playing (plus a ~350ms drain tail), transcripts and builtin
    SpeechRecognition results are still dropped (speaker bleed otherwise
    reads as speech). But vad speech-start evidence is gated by confidence,
    not time: sustained frames at >=0.85 speech prob (~2 consecutive,
    `BARGE_IN_PROB`/`BARGE_IN_FRAMES`) arm barge-in, so a real interruption
    cuts tts mid-utterance while attenuated room echo does not. Once the
    interrupt fires the gate drops immediately, so the barge-in utterance's
    own final reaches the turn. With no vad frame-prob feed the behavior is
    the previous hard gate; typed input and mute always interrupt.
  - Superseded-turn playback: a new user turn aborts the previous turn's
    controller (its pending llm/synth work stops), but pcm already
    synthesized still reaches the player instead of being dropped — only
    a confirmed barge-in `interrupt()` discards in-hand audio.
  - Voice health (`lib/voice/health.ts`): a capped `$voiceHealth` event
    ring (engine.boot ok/fail + ms, worker.error, stt.firstPartial latency,
    stt.feed/flush failures, tts.speak per utterance (total ms; first-chunk
    ms in detail) — including the
    sentence-timeout path where the remote iterator never settles,
    playback.gap/drained/stop with cause, turnstile challenge ok/fail + ms
    (managed demo endpoint only), gate decisions with vad prob —
    vad-frame events emit for the first qualifying frame and every 8th
    after, plus every high-prob/earned frame, so the ring keeps the prob
    profile without evicting boot events)
    mirrored to `window.voiceHealth` in dev for pipeline observability.
- **On-device voice (client-only)**: first browser-mode entry arms the
  root-mounted `VoiceConsentDialog` via `requestVoiceConsent()`
  (`di.voice.modelsConsent` unset): accept downloads the pinned wasm models
  (sha256-verified into CacheStorage, progress on `$voiceDownload`), decline
  keeps the Web Speech engines and is not re-asked on entry — picking
  on-device in settings -> voice re-arms the prompt instead of silently
  granting. The waveform's own capture stream is separate from `MicCapture`
  and closes when muted/inactive.
- Kickoff on silence, error toast + retry, no-speech hint: unchanged.
  Turn-pipeline errors (voice.llm/tts/stt/noResponse) latch the error
  status only until the next landed reply — the first successful agent
  turn sends RECOVERED and clears the phase; mic/boot/connect failures
  stay latched until retry rebuilds the driver. The
  no-speech hint focuses the composer (it is always mounted now — no rail or
  sheet to open). Transcript turn tags (`speaker · source`) render via
  `turnTag`/`transcript.*` keys; the error toast description maps `errors.*`
  codes via `codeMessage`, never raw driver text.
- **Client-only runtime** (ADR-0003): OPFS-backed session/turns,
  `$clientTurns` rehydration, browser driver agent loop — all unchanged.
- **Ended-session re-entry**: a `finished`/`reported`/`discarded` session
  renders the read-only summary (transcript + view report / new session)
  instead of booting a dead voice socket.

## Responsive

Mobile-first: base styles target 375px; `md` (768px) is the grid switch.

- Below `md`: single conversation card; workspace hidden; callbar timer
  hidden; ~78px bottom clearance under the card for the pillbar.
- At/above `md`: two-card grid `minmax(360px,34%) | 1fr`, 14px gap+padding.

## URL / state

- `id` path param: session id.
- Active dock tab: search param (`?tool=editor`) — URL is the source of truth.
- Voice WS URL derived from the page origin (`ws:`/`wss:` on
  `location.host`), honoring `VITE_DI_API_BASE`.
