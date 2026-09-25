# e2e: client-only runtime (no di server)

Covers the ADR-0003 client-only path: no `di` server exists, so the browser
does everything itself (OPFS persistence, `ClientAgent` LLM loop against a
BYO provider). The BYO provider's `/v1/chat/completions` endpoint is mocked
via `page.route` — this suite validates the client-only wiring, not a real
LLM.

## client-only session creation persists to OPFS

Seed `di.runtime-mode` / `di.provider-profile` in localStorage, start a
session from `/setup` via a scenario card's "start" CTA (cards skip the
validate step by default, p3), land on
`/interview/[id]`, and confirm the session record exists in OPFS
(`sessions/[id].json`) with no server involved.

## typed turn round-trips through a mocked SSE response and appears in the transcript

Open the transcript rail via the ControlBar "type" button and type a
message into the "talk or type…" box (p3 transcript-first-class input). `BrowserVoiceDriver.sendText`
drives `ClientAgent.respond` against the mocked SSE stream; both the user
and agent turns should appear in the transcript panel tagged `source: text`
(not `voice`), and both should be persisted to the OPFS turn list.

## LLM failure does not persist an empty agent turn

Point the mocked endpoint at a 500 response for one turn. The user turn is
still recorded, but no empty-text agent turn is persisted or rendered —
regression coverage for the `runAgentTurn` fix that stopped treating
`ClientAgent.respond`'s swallowed-error empty string as a successful turn.
