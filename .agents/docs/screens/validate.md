# Screen: Validate (`/validate/[id]`)

## ASCII mockup

```
+------------------------------------------------------------------+
|  [logo di]   validate: {session title}                  timer?   |
+------------------------------------------------------------------+
|                              |                                   |
|  CHAT (left ~55%)            |  INTERVIEW PLAN (right ~45%)      |
|                              |  +-----------------------------+  |
|  +------------------------+  |  | type:    system design      |  |
|  | agent: I looked at     |  |  | duration: 45 min            |  |
|  | your materials. A few  |  |  | difficulty: hard            |  |
|  | questions to sharpen   |  |  |                             |  |
|  | the plan. First: how   |  |  | focus tags:                 |  |
|  | much emphasis on       |  |  | (caching) (scaling) (API)   |  |
|  | system design?         |  |  |                             |  |
|  |                        |  |  | source refs:                |  |
|  | [user types here]      |  |  | - resume.pdf p2             |  |
|  | [send]                 |  |  | - jd.md "kafka experience"  |  |
|  +------------------------+  |  +-----------------------------+  |
|                              |                                   |
|                              |  ( edit plan )                    |
|  [ skip validation -> ]      |  ( looks good, start -> )         |
+------------------------------------------------------------------+
```

## Behavior

- Left: pre-interview LLM chat refining the plan. Chat messages POST turns to `/v1/sessions/[id]/turns`.
- Right: live interview-plan card (type, duration, difficulty, focus tags, source refs) rendered from the structured plan.
- **Edit plan** makes the plan card fields editable inline; edits update the session's plan.
- **Looks good, start** -> `/interview/[id]`.
- **Skip validation** link bottom-left -> `/interview/[id]` unvalidated.
- M4 feature: in M1 this screen is reachable but the chat panel shows a "validation comes later" stub, plan card renders from the setup inputs.

## URL / state

- `id` path param: session id. Session loaded via TanStack Query (GET /v1/sessions/:id).

## Responsive

- Mobile-first: two cards stack to one column below `md` (`md:grid-cols-[1.2fr_1fr]`).
- Plan rows wrap label/value with `flex-wrap` so long titles do not clip at 375px.
- Start CTA is full-width on mobile (`w-full` base, `sm:w-auto`).
