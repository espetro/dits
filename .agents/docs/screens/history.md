# Screen: History (settings dialog pane "Previous sessions")

The standalone `/{-$locale}/history` route was removed. History lives on as a
pane inside the URL-driven settings dialog: any route can open it via
`?settings=1&pane=history` or the user dropdown's "Previous sessions" item.
The finish screen's "discard" button also opens this pane
(`openSettings("history")`).

## ASCII mockup

```
+------------------------------------------------------------------+
|  [logo di]                                    [settings] [github] |
|  +-------------------------------------------------------+        |
|  |  ... settings dialog ...                              |        |
|  |  +-----------------------------------------------+   |        |
|  |  | PREVIOUS SESSIONS                             |   |        |
|  |  +-----------------------------------------------+   |        |
|  |  | backend screen      interview  45m  reported  |   |        |
|  |  | frontend loop       interview  30m  finished  |   |        |
|  |  | system design drill coach     20m  reported   |   |        |
|  |  +-----------------------------------------------+   |        |
|  |        (click row -> /report/[id] or /finish/[id])    |        |
|  +-------------------------------------------------------+        |
+------------------------------------------------------------------+
```

## Behavior

- Dialog state is URL-driven (raw query string, popstate-synced; see
  `settings-dialog.tsx`). Deep-linkable, back/forward close and re-open it.
- Lists past sessions from the same store the old page used, newest first.
- Clicking a row navigates to `/report/[id]` (reported sessions) or
  `/finish/[id]` (finished but unreported).

## Responsive

- Dialog fills the viewport below `sm`; centered card with backdrop from `sm`
  up.

## Notes

- The pane label is "Previous sessions" (`settings.history` locale key); the
  `history` id is kept for URL continuity.
