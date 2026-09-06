# Screen: Finish (`/finish/[id]`)

## ASCII mockup

```
+------------------------------------------------------------------+
|                        interview complete                        |
|                     "{session title}"                            |
|                     32 minutes · 14 turns                        |
|                                                                  |
|              +-----------------------------+                     |
|              |       get transcript        |  (download JSON)    |
|              +-----------------------------+                     |
|              +-----------------------------+                     |
|              |       generate report       |  => /report/[id]    |
|              +-----------------------------+                     |
|                                                                  |
|                        ( discard )                               |
+------------------------------------------------------------------+
```

## Behavior

- Arrives here from timer hard-stop or early end (both interview exit paths).
- **Get transcript**: downloads both sides (user + agent) as JSON (GET /v1/sessions/[id]/turns).
- **Generate report**: requests report generation (worker -> POST /v1/sessions/[id]/report), then routes to `/report/[id]`. Button shows a pending state while the report is being produced.
- **Discard**: marks session discarded (status change) and returns to `/history`.

- **Client-only runtime** (ADR-0003, `$effectiveRuntime === "client-only"`):
  session summary and transcript come from OPFS
  (`web/src/lib/opfs-store.ts#getClientSession` /
  `#getClientTurns`) instead of `GET /v1/sessions/[id]` /
  `GET /v1/sessions/[id]/turns`. Transcript download and report navigation
  behave the same either way.

## URL / state

- `id` path param: session id. Session summary fetched via TanStack Query.

## Responsive

- Mobile-first: centered column capped at `max-w-md`, usable at 375px.
- Session title scales `text-3xl` base -> `sm:text-4xl` and breaks long words so long titles do not overflow.
- Button stack is full-width base; transcript dropdown stays anchored inside the button container.
