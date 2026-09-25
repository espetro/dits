# ADR 0003: client-only runtime for static (CF Pages) deploys

status: accepted (2026-09-05)
builds on: ADR-0002 (WebSocket + Web Audio voice transport)
plan: `.agents/plans/2026-09-04-distribution-client-side.md`

## context

ADR-0002 already split voice into a `SpeechDriver` interface with two
implementations (`server-driver`, `browser-driver`) so the app degrades from a
WS voice pipeline to Web Speech API when there is no `di` binary to talk to.
That covered STT/TTS, but everything else — session creation, turn
persistence, report scoring — still assumed a `di` server and its sqlite
store. A static deploy (Cloudflare Pages, no server process, no database)
needed those to work with nothing but the browser and a BYO OpenAI-compatible
provider.

## decision

Add a third axis, orthogonal to the voice driver split: a **runtime mode**
(`apps/web/src/lib/runtime.ts`) that is `local-server` (default) or `client-only`,
persisted (`$runtimeMode`) and overridden to `client-only` whenever a health
probe finds the configured server unreachable ($effectiveRuntime, computed —
never rewrites the persisted choice). Every route that currently calls the
REST API branches on `$effectiveRuntime`:

- **setup** (`apps/web/src/routes/setup.tsx`): client-only creates the session via
  `apps/web/src/lib/opfs-store.ts#createClientSession` instead of `POST
/v1/sessions`, and skips document upload (no ingestion pipeline exists
  client-side — files are accepted by the picker but dropped). Also resets
  `$clientTurns`/`$currentQuestion` (`resetClientSession`) so a new session
  never inherits a previous one's turns from the nanostore.
- **interview** (`apps/web/src/routes/interview.$id.tsx`): session/turns come from
  OPFS + `$clientTurns` instead of REST polling; typed and spoken turns run
  through `ClientAgent` (ADR-0002's `browser-driver`) and are persisted via
  `opfs-store.ts#appendClientTurn` as they're produced, since there is no
  server to persist them.
- **finish** (`apps/web/src/routes/finish.$id.tsx`): reads session/turns from OPFS
  instead of REST for the transcript download.
- **report** (`apps/web/src/routes/report.$id.tsx`): checks
  `opfs-store.ts#getClientReport` first; if absent, scores the transcript with
  `apps/web/src/lib/agent/report-generator.ts#generateReport` (an AI SDK
  `generateObject` call against the BYO provider, schema-constrained to
  `ReportSchema`) and persists the result with `saveClientReport`.

### storage: one OPFS file per session, not a client-side sqlite

`opfs-store.ts` keeps one JSON file per session
(`sessions/<id>.json`, `{session, turns, report?}`) under
`navigator.storage.getDirectory()`, read-modify-write. No IndexedDB, no
sql.js/wasm sqlite: a single interview is a few hundred turns at most, so
there is no query workload that justifies an embedded database, and JSON
read-modify-write mirrors `apps/server/src/store/db.ts`'s responsibilities closely
enough that the two are easy to keep in sync by inspection.

### report prompt: new shared contract, not reused

The handoff plan assumed the server had a report-generation prompt to reuse
read-only. It does not — `apps/server/src/api/routes.ts` only stores and retrieves
a client-supplied report; nothing in `apps/server/src` ever scores a transcript.
`buildReportPrompt`/`ReportPromptContext` (`packages/shared/src/report.ts`) is a new
prompt, designed from scratch and placed in `packages/shared/` specifically so a
future server-side generator (e.g. for `local-server` mode once the server
gains its own LLM-scoring endpoint) would consume the identical contract
instead of drifting from the client-only one.

### the seam this leans on

None of the above needed new abstractions because ADR-0002's ports/adapters
split already drew the line in the right place: `ClientAgent` and the
server's `VoiceLoop` both consume `packages/shared/src/interview-agent.ts`
(`buildPrompt`/`VOICE_TOOLS`/`describeWhiteboardSnapshot`), and `packages/shared/`'s
valibot schemas (`Session`, `Turn`, `Report`) are the wire format regardless
of whether the far end is `di`'s sqlite or an OPFS JSON file. Client-only mode
is additive: a second implementation behind the same contracts, not a fork of
the app.

## consequences

- a fully static bundle (CF Pages, GitHub Pages, `file://` even, modulo OPFS
  support) can run a complete interview loop with zero backend, provided the
  user supplies an OpenAI-compatible `baseUrl`/`apiKey`.
- client-only sessions are **per-browser-profile**: OPFS is origin-scoped and
  not synced, so switching browsers or clearing site data loses history.
  `local-server` mode's sqlite store has no such limit. This is accepted, not
  worked around — a client-only user who wants durability points their
  `baseUrl` at a real `di` server instead.
- report scoring cost moves to the BYO provider bill in client-only mode
  (one `generateObject` call per report) instead of running on `di`'s
  configured LLM; this is the intended tradeoff of "no server."
- the OPFS schema (`SessionRecord`) and the sqlite schema
  (`apps/server/src/store/db.ts`) are two representations of the same `packages/shared/`
  contracts, kept honest only by both compiling against `Session`/`Turn`/
  `Report` — there is no migration path between them (by design: moving a
  session from client-only to local-server would need an explicit export/
  import feature, not yet built).
