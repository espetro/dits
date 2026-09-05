# web/AGENTS.md

TanStack Start SPA. Build output is `web/dist/client` (note: `client`, not
the `dist` root) — `mise run build` builds it.

## Routes (`src/routes/`)

`/`, `/setup`, `/validate/$id`, `/interview/$id`, `/finish/$id`,
`/report/$id`, `/history`. Forms validated against `@di/shared` schemas
(formisch). Update the matching `.agents/docs/screens/*.md` in the same
commit as any route behavior change — a spec enforces `tests/e2e` stays in
sync with these headings too.

## State

nanostores atoms for local/UI state; TanStack Router file routes with `$id`
params. See `.agents/docs/screens/*.md` for the per-route contract.

## Components & design tokens

shadcn/ui is the base component library. Design tokens live in
`src/theme.css` (`@theme` block): the di palette (cream/espresso/persimmon)
plus the shadcn semantic tokens (`--color-popover`, `--color-accent`,
`--color-border`, `--color-primary`, …) mapped onto it. Always style via
those semantic classes (`bg-popover`, `text-muted-foreground`,
`focus:bg-accent`), never raw hexes.

- `src/components/vendor/` holds CLI-fetched shadcn primitives
  (`components.json` aliases `ui` → there). **Never edit vendored files**
  — treat them as generated. Fix at the call site or wrap.
- Never hand-roll a control that shadcn ships (button, input, label, tabs,
  radio-group, select, dialog, dropdown-menu…). Build customs **on top of**
  vendored primitives, in their own module (e.g. `locale-switcher.tsx`
  wraps `Button variant="outline"` + `dropdown-menu`).
- Add new primitives with `bunx shadcn@latest add <name>` from `web/`,
  then commit them as a separate vendor commit. Run `bunx oxfmt` on new
  vendor files (CLI output fails `oxfmt --check` as generated).

## Responsive

Mobile-first: base styles target small viewports; `sm:`/`md:`/`lg:`
progressively enhance. Every route must be usable at 375px and 1440px.
Mobile may need different components than desktop (e.g. Sheet instead of
a static rail, full-screen instead of centered dialog) — build both from
shadcn primitives (`sheet`, `drawer`), never bespoke markup. Update the
matching `.agents/docs/screens/*.md` spec in the same commit whenever a
screen's responsive behavior changes.

## Icons

lucide-react only (project decision). Do not add other icon sets.

## Voice client (`src/lib/voice/`)

`SpeechDriver` interface: a WebSocket `ServerVoiceDriver` (default) and a
`BrowserVoiceDriver` (client-only/static-build fallback, Web Speech API +
client-side agent loop). xstate v5 turn FSM, Web Audio capture (16k PCM16)
with client-side Silero VAD, `PcmPlayer` playback.

- Driver selection (`src/lib/voice/index.ts`): runtime mode (`client-only` forces browser driver) → `VITE_VOICE_DEFAULT` env pin → probe `/api/health` (reachable → server driver, unreachable → browser driver).
- VAD assets (silero onnx + onnxruntime wasm) are vendored in `web/public/vad/` and must stay committed for offline/local-first use.
- `src/lib/agent/` — the client-only agent loop (`client-agent.ts`), an OpenAI-compatible provider conforming to `@ai-sdk/provider`'s `LanguageModelV3` (`openai-compatible-provider.ts`), and browser TTS (`tts.ts`). Shares `buildPrompt`/`VOICE_TOOLS`/`describeWhiteboardSnapshot` from `shared/src/interview-agent.ts` with the server loop — errors here must reach `onError`, never resolve silently (ast-grep rule `no-swallowed-agent-errors`).
