# Screen: Finish (`/finish/[id]`)

> p3: report builds automatically — this screen is a progress state, not a
> decision point. Manual actions remain as secondary controls.

## ASCII mockup

```
+------------------------------------------------------------------+
|                        interview complete                        |
|                     "{session title}"                            |
|                     32 minutes · 14 turns                        |
|                                                                  |
|                        building your report                      |
|                     ((( working dots )))                          |
|                                                                  |
|              +-----------------------------+                     |
|              |       get transcript        |  (download JSON)    |
|              +-----------------------------+                     |
|              +-----------------------------+                     |
|              |       open report           |  => /report/[id]    |
|              +-----------------------------+                     |
|                                                                  |
|                        ( discard )                               |
+------------------------------------------------------------------+
```

## Behavior

- Arrives here from timer hard-stop or early end (both interview exit paths).
- **Auto-advance (p3)**: on mount the screen fires report generation itself
  (server mode: POST /v1/sessions/[id]/report; client-only: the local
  generator) and renders a "building your report" state — a progress pulse
  plus elapsed note, no user action needed. When the report lands it
  auto-navigates to `/report/[id]`.
- **Failure honesty**: if generation fails the progress state swaps to the
  error + a `try again` button; the manual controls below stay usable
  throughout. No infinite spinner.
- **Get transcript**: downloads both sides (user + agent) as JSON
  (GET /v1/sessions/[id]/turns). Available while the build runs.
- **Open report**: always rendered; disabled (pending style) until a report
  exists, then routes to `/report/[id]`.
- **Discard**: marks session discarded (status change) and returns to
  `/history`.
- **Client-only runtime** (ADR-0003, `$effectiveRuntime === "client-only"`):
  session summary and transcript come from OPFS
  (`apps/web/src/lib/opfs-store.ts#getClientSession` / `#getClientTurns`);
  the auto-build uses the in-browser report generator and the navigation
  behaves the same either way.

## URL / state

- `id` path param: session id. Session summary fetched via TanStack Query
  (server mode) or OPFS (client-only). Report completion is polled/exposed
  by the same source.

## Responsive

- Mobile-first: centered column capped at `max-w-md`, usable at 375px.
- Session title scales `text-3xl` base -> `sm:text-4xl` and breaks long
  words so long titles do not overflow.
- Button stack is full-width base; transcript dropdown stays anchored inside
  the button container.
