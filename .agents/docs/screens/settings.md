# Screen: Settings dialog (account dropdown, centered)

Centered glass dialog opened from the account dropdown (B3). Three panes:
History, AI Provider and Settings. Desktop: left sidebar nav. Mobile:
full-screen with a top tab bar.

## ASCII mockup

```
                 +------------------------------------------+
                 | History     |  +-----------------------+ |
                 | AI Provider |  | backend    reported 2d  | |
                 |          |  | frontend  interviewing   | |
                 |          |  | ...                      | |
                 |          |  | (empty: history.empty)   | |
                 +------------------------------------------+
```

## Behavior

- Desktop: max-w-2xl flex-row glass panel (backdrop blur, rounded-2xl, p-0).
  Left nav (w-44): History + AI Provider + Settings buttons, active row bg-muted.
  Right pane: bg-card rounded panel, overflow-y.
- Mobile: full-screen override (inset-0 h-svh w-screen, no rounding, close
  button hidden) via useIsMobile media-query hook. Responsive layout: the
  vertical sidebar is replaced by a top tab bar (shadcn Tabs, full-width
  TabsList with icon + label per pane) switching the same panes; the content
  area scrolls with overflow-y-auto and drops the card chrome to fit 375px.
  Usable at 375px: stacked inputs, flex-wrap radio rows, no horizontal
  overflow.
- History pane: client-only load from OPFS via listClientSessions in useEffect
  (SSR renders "..." then rows or the history.empty empty state). Rows link to
  /interview/$id, /finish/$id or /report/$id by status, mirroring the history
  route's target() logic, with a status chip and relative date
  (history.today/yesterday/daysAgo/weeksAgo keys).
- AI Provider pane (B4): three sub-tabs STT / TTS / LLM. Each chooses
  In-browser (section omitted from the profile; speechSynthesis / Web Speech
  fallback; not offered for LLM) vs Custom endpoint (baseUrl, apiKey shown
  redacted when saved via redactKey, model, voice for TTS). One Save button
  validates the whole shape with ProviderSectionsSchema; an LLM section is
  required. Per-section Test button: LLM runs a tiny streamed completion, TTS
  synthesizes a short phrase, STT probes ${base}/v1/models; ok/err shown
  inline. Any route can open the pane via openSettings("aiProvider") from
  settings-dialog.tsx (used by the setup needsProvider notice).
