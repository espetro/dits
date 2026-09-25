# Screen: Interview (`/interview/[id]`)

> p3 restructure: conversation leads, tools follow. One AgentStage zone
> carries presence (orb + state word + live caption); the transcript is a
> demoted rail/sheet; user tools live in a registry-driven dock.

## ASCII mockup

```
+------------------------------ desktop (>= md) -----------------------------+
|  {session title}                                   27:41                  |
+---------------------------------------------------------------------------+
|                                                     |  T transcript       |
|                    ((o)) voice orb                  |  agent: so,         |
|                    listening...                     |  tell me...         |
|   "how would you handle cache invalidation          |                     |
|    across regions?"  <- live caption                |  user: well,        |
|                                                     |  I'd start...       |
|  +----------------------------------------------+   |                     |
|  | QUESTION 3            [progress chip]         |   |                     |
|  | "How would you handle cache invalidation      |   |                     |
|  |  across regions?"                             |   |                     |
|  |  hints: - think about TTLs                    |   |                     |
|  |         - consistency vs availability         |   |                     |
|  +----------------------------------------------+   |                     |
|                                                     |                     |
|  [editor] [whiteboard] [+]                          |                     |
|  +----------------------------------------------+   |                     |
|  | TOOL PANE (active dock tab)                   |   |                     |
|  |  def solve(nums): ...        / tldraw canvas  |   |                     |
|  +----------------------------------------------+   |                     |
|                                                     |  [ talk or type... ]|
+-----------------------------------------------------+---------------------+
|  [mute]            [type]              [end early]  |  <- sticky, safe-area|
+---------------------------------------------------------------------------+

+------------------------------ mobile (< md) -------------------------------+
|  {title}                                            27:41                 |
+---------------------------------------------------------------------------+
|                          ((o))                                            |
|                       listening...                                        |
|   "how would you handle cache..."   <- live caption (2-line clamp)        |
|                                                                           |
|  +----------------------------------------------+                         |
|  | QUESTION 3                                    |                         |
|  | "How would you handle..."                     |                         |
|  +----------------------------------------------+                         |
|  [editor] [+]                                                             |
|  +----------------------------------------------+                         |
|  | TOOL PANE                                     |                         |
|  +----------------------------------------------+                         |
|                                                                           |
+-----------------------------------------------------( [transcript] sheet)-+
|  [mute]            [type]              [end early]  | <- sticky, safe-area|
+---------------------------------------------------------------------------+
```

## Zones

### AgentStage (new)

The single zone that carries the agent's presence, always visible:

- **Voice orb** (`apps/web/src/components/voice-orb.tsx`, ElevenLabs Orb /
  three.js, css-pulse fallback in client-only mode) centered, `size-20
  md:size-24`. Driven by `$micAttack`/`$agentAttack` loudness taps
  (`lib/voice/levels.ts`) with synthetic oscillation fallback. Phase mapping:
  speaking→talking, listening→listening, thinking→thinking, else null.
  **The orb leaves the transcript rail**: it renders in AgentStage, not the
  rail, so the state is semantic and the volume is motion (orb-ui contract).
- **State word** under the orb: listening / thinking / speaking /
  reconnecting / error — replaces the top-bar status pill as the always-on
  voice state readout.
- **Live caption**: the latest agent utterance as plain text, 2-line clamp
  (no scroll needed mid-turn; full text stays in the transcript). During
  user turns the caption holds so the last question remains on screen.

### QuestionCard

- **Progress chip** `QUESTION n` — n counts `update_question` tool calls (and
  question-replacing agent turns under the text fallback) this session.
- Question text + optional hints, agent-editable via `update_question` (server
  mode also pushes a `{t:"question"}` ws message). Fallback when no structured
  question has landed: latest agent turn text — never empty past kickoff.
- Renders directly under AgentStage; it is part of the conversation, not the
  tool dock.

### ToolDock + ToolSpec registry (new)

- `session.tools` becomes `Record<toolId, variant>` (ordered map; variant is
  per-tool config like the editor's language) — replaces the fixed
  `{editor, whiteboard}` pair. Schema change lives in `@di/shared`
  (`ToolStateSchema` widens to a record).
- Registry (`apps/web/src/lib/tools/registry.ts`) — one `ToolSpec` per tool:
  `id`, i18n `labelKey`, lucide `icon`, lazy `component`, `agentAccess:
  "read" | "write" | "read-write"`, `platforms: "all" | "server-only"`.
  `agentAccess` controls which agent tools the spec exposes (`read_*` /
  `update_*` generation is per-spec), `platforms` hides heavy tools
  (whiteboard stays `server-only` while tldraw is bundled).
- Presets pick the toolset: the scenario card seeds `session.tools`; `custom`
  starts with editor only. `>4` tools collapses trailing tabs into a `+`
  overflow picker.
- The dock renders under the QuestionCard, full width, one active tab.
- Agent read tools keep the same turn-path integration and the same test
  contract (unit serializers, evals, `/v1/test/events` assertions).

### Transcript

- **Desktop (`>= md`)**: right rail, translucent (10-20% alpha), peek/collapse
  via `transcriptOpen`, minimize never fully hides. Contains the turn list and
  the type input at its bottom.
- **Mobile (`< md`)**: bottom `Sheet` (vendored, not side Sheet) opened from
  the ControlBar `type` button; same turn list + input.
- **Type input is first-class**, not a fallback: placeholder "talk or
  type...". When voice is up it sends `{t:"text"}` on the ws (same pipeline
  as speech); in client-only it goes through `BrowserVoiceDriver.sendText`.
  `POST /v1/sessions/:id/turns` remains the degraded-path write only.

### ControlBar (new, replaces bottom-left mute/end buttons)

- Sticky bottom bar on **every** viewport, `padding-bottom:
  env(safe-area-inset-bottom)`, all targets `>= 44px`.
- Left: **mute** toggle (`{t:"mute",muted}` on the wire, mic track kept).
- Center: **type** — desktop focuses the rail input (opens the rail if
  collapsed), mobile opens the transcript Sheet with input focused.
- Right: **end early** — confirm, then `/finish/[id]`.
- **Back-guard**: while voice is connected or the interview is in progress,
  browser back/close fires a confirm (`beforeunload` + router blocker) so a
  swipe/accidental nav can't silently drop the session. Inert once ended.

## Behavior

- Top bar: session title + countdown anchored to `session.created_at`
  (T-2min wrap-up, 0 hard-stops to `/finish/[id]`). The status pill moves out
  of the top bar — AgentStage owns voice state.
- Voice wiring is unchanged: WebSocket + Web Audio, 16k PCM16 capture, Silero
  VAD (`/vad/` vendored), binary frames while speaking + `{t:"utterance_end"}`,
  `{t:"interrupt"}` barge-in (300ms grace on the browser driver), reconnect
  with backoff, voice->text degradation surfaces the type path immediately.
- Kickoff on silence, error toast + retry, no-speech hint: unchanged. The
  no-speech hint now points at the ControlBar `type` button / rail input
  instead of rendering its own input inside the QuestionCard.
- **Client-only runtime** (ADR-0003): OPFS-backed session/turns, `$clientTurns`
  rehydration, browser driver agent loop — all unchanged. Platform filters in
  the ToolSpec registry replace the hardcoded whiteboard-tab hiding; the orb
  still renders the css-pulse fallback to keep gpu headroom for in-browser llm.
- **Ended-session re-entry**: opening `/interview/[id]` for a session whose
  status is `finished`/`reported`/`discarded` renders a read-only summary
  (transcript + tools snapshot, no mic) with a `view report` / `new session`
  CTA instead of booting a dead voice socket.

## Responsive

Mobile-first: base styles target 375px; `sm:`/`md:`/`lg:` enhance. `md`
(768px) is the rail/Sheet switch.

- Single column below `md`: AgentStage, QuestionCard, ToolDock stacked; the
  transcript rail is not rendered (Sheet only).
- AgentStage orb shrinks one step (`size-20`), caption clamps to 2 lines.
- ControlBar buttons never wrap: mute/type keep icon+short-label, `end early`
  truncates. Height is fixed (single row) so ToolDock height math is stable.
- `viewport-fit=cover` on the root viewport meta + safe-area padding on the
  ControlBar handle notched devices.

## URL / state

- `id` path param: session id.
- Active dock tab: search param (`?tool=editor`) — URL is the source of truth.
- Voice WS URL derived from the page origin (`ws:`/`wss:` on
  `location.host`), honoring `VITE_DI_API_BASE`.
