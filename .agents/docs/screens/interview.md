# Screen: Interview (`/interview/[id]`)

## ASCII mockup

```
+------------------------------------------------------------------+
|  {session title (fixed)}        27:41    ((o)) voice orb (rail) |
+------------------------------------------------------------------+
|                                                     | T transcri.+|
|  +----------------------------------------------+  | agent: so,  |
|  |  QUESTION BLOCK (agent-editable tool)        |  | tell me...  |
|  |                                              |  |             |
|  |  Q3: "How would you handle cache             |  | user: well, |
|  |  invalidation across regions?"               |  | I'd start   |
|  |  hints:                                      |  | with...     |
|  |  - think about TTLs                          |  |             |
|  |  - consistency vs availability               |  | user: [the  |
|  |                                              |  | agent's     |
|  +----------------------------------------------+  | current     |
|                                                    | question    |
|  +-------------------------+-------------------------+ rewrites   |
|  | EDITOR                  | WHITEBOARD             ||             |
|  | (CodeMirror w/          | (tldraw canvas —       ||             |
|  |  syntax highlighting)   |  diagrams; agent can   ||             |
|  |  def solve(nums):       |  read its contents)    ||             |
|  |                         |    ...                 || [ type      |
|  +-------------------------+-------------------------+  here...  ] |
|                                                    +-------------+|
|  [mute]  [end early]                                               |
+------------------------------------------------------------------+
```

## Behavior

- Top bar: fixed session title, countdown timer (T-2min triggers agent wrap-up; 0 hard-stops to `/finish/[id]`), voice status label. The voice orb lives in the desktop transcript rail (see below), not the top bar.
- **Voice orb** (desktop): ElevenLabs UI Orb (`web/src/components/voice-orb.tsx` wrapping the vendored `components/vendor/orb.tsx`, three.js/WebGL) sits above the transcript rail, `size-20 md:size-24`. Driven by live mic/agent loudness taps (`web/src/lib/voice/levels.ts`: `$micAttack`/`$agentAttack` nanostores fed by `MicCapture` RMS and `PcmPlayer.write`) with a synthetic oscillation fallback when taps are silent (e.g. browser STT driver). Phase mapping: speaking→talking, listening→listening, thinking→thinking, else null. The vendor file carries three di-local fixes, each marked with a `di fix`/`di:` comment: (1) `flat` Canvas + own rAF `advance()` loop because r3f's global loop deadlocks under React StrictMode's double-mount (`internal.active` stays false after `unmountComponentAtNode`'s delayed teardown reuses the root); (2) `uInverted` flips on the LIGHT theme since the shader ramp is dark-first and washes out on di's cream background; (3) context-restored kick via `forceContextRestore`.
- **Question block**: agent-editable tool. The agent rewrites the current question + hints live (tool call). User tools (editor, whiteboard) are never rewritten by the agent, but the agent can READ them.
- **Tabbed tools**: full-width below the question block. Tabs: `Editor | Whiteboard`. Editor = Milkdown (Crepe) WYSIWYG markdown (`web/src/components/milkdown-editor.tsx` + `milkdown-editor-impl.tsx`, lazy-loaded; three.js-free chunk) with a language bar (`python javascript typescript java go rust sql`) that inserts a fenced code block with the chosen language tag; code blocks render via CodeMirror 6 with syntax highlighting inside the document. External buffer sync via `replaceAll`; changes propagate through `markdownUpdated`. Whiteboard = tldraw canvas for diagrams.
  - **Agent read tools**: `read_editor` (returns current editor buffer text) and `read_whiteboard` (returns serialized shape/snapshot summary). Both feed the same LLM turn path as the transcript, so the agent can reason over code and diagrams the candidate produces.
  - This is part of the test contract: unit tests for the read-tool serializers, evals asserting the agent incorporates editor/whiteboard content in its turns (mock provider scripted with tool-call fixtures), and e2e assertions via `/v1/test/events` that `read_editor` / `read_whiteboard` tool calls land in the session event log.
- **Transcript panel**: right side, translucent (10-20% alpha, iOS-26 style so background shows through), 10-20% collapsed-to-expanded width range.
  - Collapsed state = slim peek rail showing the last turn. **Minimize never fully hides it.**
  - Bottom of panel: text input box. Text input is a first-class feature: posts a `source: text` turn via `POST /v1/sessions/:id/turns`, the same LLM turn path as voice.
- Voice wiring: WebSocket + Web Audio, no SFU/WebRTC. On mount the screen picks a speech driver: the server driver (`web/src/lib/voice/server-driver.ts`) opens `GET /v1/sessions/:id/voice` (WS) and streams mic audio: `AudioWorklet` capture at 16k PCM16 mono (browser resamples via the `AudioContext` rate), client-side Silero VAD (`@ricky0123/vad-web`, assets vendored at `/vad/`) delimits utterances; frames go out as binary WS frames (4-byte BE seq + PCM16LE) only while the VAD says the user is speaking, ending with `{t:"utterance_end"}`. Server messages drive playback and UI: `tts` chunks (b64 or binary with the same seq framing) play through a `PcmPlayer` (`AudioContext` at 24k, back-to-back `AudioBufferSourceNode` scheduling); `agent_speaking` on/off, `user_transcript` / `agent_transcript` surface for state (transcript display still comes from turns polling). Barge-in: a VAD speech-start during agent playback stops the player and sends `{t:"interrupt"}`. Mute keeps the mic track but drops frames client-side and sends `{t:"mute",muted}`. An xstate v5 FSM (`web/src/lib/voice/machine.ts`: idle→connecting→listening→user_speaking→thinking→agent_speaking→listening, barge-in via interrupted) drives the status label.
- Driver fallback: `web/src/lib/voice/browser-driver.ts` (Web Speech API: `SpeechRecognition` for STT posting turns via the same REST endpoint, `speechSynthesis.speak` for agent turns the turns polling finds; Chrome-only in practice). Selection (`web/src/lib/voice/index.ts`): `VITE_VOICE_DEFAULT` pins one; otherwise probe `${BASE}/api/health` — reachable means the di binary hosts the WS endpoint. Both drivers post turns through the existing REST API, so transcripts and reports are identical regardless of driver. Turn `seq` is assigned server-side on `POST /v1/sessions/:id/turns` (max existing seq + 1), so concurrent writers (voice, text input) never collide.
- Controls bottom: mute, end-early. Both end paths lead to `/finish/[id]`.
- **Client-only runtime** (ADR-0003, `$effectiveRuntime === "client-only"`):
  no `di` server, so this screen swaps its data source instead of its voice
  driver. Session/turns come from OPFS (`web/src/lib/opfs-store.ts`) and the
  `$clientTurns` nanostore instead of REST polling; the browser driver's
  `ClientAgent` runs the LLM loop directly against the BYO `baseUrl`, and
  every turn it emits (`onUserTurn`/`onAgentTurn`) is both pushed onto
  `$clientTurns` for immediate display and persisted to OPFS
  (`web/src/lib/voice/use-voice.ts`), since there is no server-side turn
  store to poll. Turn `seq` is assigned client-side (`Date.now()`-based in
  `browser-driver.ts`) rather than server-side, since there is no shared
  writer to serialize against. Typed input reuses the same agent path via
  `BrowserVoiceDriver.sendText` / `voice.sendText`, rather than
  `POST /v1/sessions/:id/turns`. The `pushToolState` REST call (editor/
  whiteboard mirroring) is skipped entirely in this mode — client-only's tool
  executors read the nanostores in-process, so there is nothing to push.

## Responsive

Mobile-first: base styles target 375px; `sm:`/`md:`/`lg:` enhance toward the
desktop layout above. The `md` breakpoint (768px) is the rail/Sheet switch.

- **Layout**: single column below `md` (header, question block, tabbed tools,
  controls stacked); the two-column main + transcript rail arrangement applies
  from `md` up. No horizontal overflow at 375px.
- **Transcript**: two presentations of the same data:
  - **Desktop (`>= md`)**: the static translucent aside rail (peek/collapse via
    `transcriptOpen`), unchanged. Text input lives at its bottom.
  - **Mobile (`< md`)**: the aside is not rendered. A floating round button
    (fixed, bottom-right, `PanelRight` icon, `aria-label="transcript"`) opens a
    vendored `Sheet` (side right) holding the same turn list and text input.
    The Sheet is controlled by the same turns/text state; the peek rail and
    `$transcriptOpen` are desktop-only concepts.
- **Top bar**: title truncates (`min-w-0 truncate`), the voice status label
  hides below `sm`. The app navbar (logo + settings trigger, see
  `navbar.md`) renders above the session header on all routes.
- **Controls**: mute / end-early stretch to full width below `sm`
  (`flex-1`, `truncate` on the end label), restore fixed widths from `sm` up.

## URL / state

- `id` path param: session id.
- Active tool tab: search param (`?tab=editor`) — URL is the source of truth.
- Voice WS URL derived from the page origin (`ws:` / `wss:` on `location.host`), honoring `VITE_DI_API_BASE` overrides like the rest of the API client.
