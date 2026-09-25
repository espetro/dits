# Screen: Report (`/report/[id]`)

## ASCII mockup

```
+------------------------------------------------------------------+
|  [logo di]   report: {session title}            (export) history  |
+------------------------------------------------------------------+
|                                                                  |
|  +---------------+  +---------------+  +---------------------+   |
|  | overall       |  | coverage      |  | duration / turns    |   |
|  |    7.2 / 10   |  |    80%        |  | 32 min · 14 turns   |   |
|  +---------------+  +---------------+  +---------------------+   |
|                                                                  |
|  COMPETENCIES (bento + bars)                                     |
|  +-----------------------------------------------------------+   |
|  | system design       [==========--] 8.0                    |   |
|  |  WORKED  "I would shard by user id" (turn 12)             |   |
|  |  IMPROVE "didn't address failover" (turn 18)              |   |
|  | api design          [========-----] 6.5                    |   |
|  |  WORKED  "idempotency keys on POST" (turn 9)              |   |
|  |  DROP    "forgot auth on the webhook" (turn 22)           |   |
|  +-----------------------------------------------------------+   |
|                                                                  |
|  MODEL ANSWERS                                                   |
|  +-----------------------------------------------------------+   |
|  | Q: design a URL shortener                                 |   |
|  | A: a strong answer covers key space, collisions, 301/302… |   |
|  +-----------------------------------------------------------+   |
|                                                                  |
|         +--------------------------------------+                 |
|         |   practice weak areas ->             |  seeds coach    |
|         +--------------------------------------+                 |
+------------------------------------------------------------------+
```

## Behavior

- Score bento at top: overall / 10, coverage %, meta (duration, turns).
- Competency list: name + bar + score; under each, verbatim evidence quotes tagged `worked / improve / drop` with turn references. Quotes are verbatim transcript text (hallucination guard: every claim carries a quote that exists in the transcript).
- Model answers section: question text + reference answer.
- **Export**: downloads the report JSON (already persisted; the report itself is produced by `POST /v1/sessions/[id]/report`).
- **Practice weak areas ->** enabled coach CTA: seeds `$draft` with
  `mode: coach` and a report.coachSeed prompt naming the weakest competency,
  then navigates to `/setup` where the user confirms and starts it.
- Scoring is async (ScoringPoll pattern): the report query fires `POST /v1/sessions/[id]/report`, which generates the report on first call (or returns the stored one — idempotent) and persists it with status `reported`.
- **Loading state**: spinner with `report.scoring` copy; after 15s swap in
  `report.scoringSlow` ("this can take a minute on free models") so slow
  providers don't look stuck.
- **Failure toast**: in addition to the inline failure state below, a
  sonner toast (`report.failed` + `report.failedBody` as description)
  fires when the report query errors, so the failure is visible even if
  the user has navigated or scrolled away.
- **Failure state**: if scoring fails (provider error, abort) show
  `report.failed` / `report.failedBody` ("the agent failed to score this
  session — check your AI provider settings") with a `report.tryAgain`
  retry button and a link back to the transcript. No "not wired yet" copy —
  that was dishonest about the failure mode.

- **Client-only runtime** (ADR-0003, `$effectiveRuntime === "client-only"`):
  no server-side scoring exists to poll. This screen first checks
  `apps/web/src/lib/opfs-store.ts#getClientReport`; on a miss it scores the OPFS
  transcript itself via `apps/web/src/lib/agent/report-generator.ts#generateReport`
  (one `generateObject` call against the BYO provider, constrained to
  `ReportSchema` from `packages/shared/src/report.ts`) and persists the result with
  `saveClientReport` before rendering — same "pending -> scored" UI either
  way, just a different producer. The call is bounded by a 90s
  `AbortSignal.timeout`; on timeout/abort the failure state above renders
  instead of spinning forever.

## URL / state

- `id` path param: session id. Report via TanStack Query (POST /v1/sessions/[id]/report,
  or the client-only path above when there is no server).

## Responsive

- Mobile-first: score bento stacks to one column below `md` (`grid-cols-1` -> `md:grid-cols-3`).
- Competency rows wrap name/score with `flex-wrap`; verdict badges and quotes already wrap via `flex-wrap`.
- Practice CTA is `max-w-full` so long labels never overflow 375px; container paddings are `px-4` base, `md:px-8`.
