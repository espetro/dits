# plan: e2e remediation + ui recovery

status: approved by quim (2026-09-25)
source: adversarial research, 2026-09-25 (two rounds: runtime/e2e + ui)
related: adr-0002, adr-0003, adr-0004

## 0. strategy

one product contract, two runtimes, two capability tiers.

- **core** - everything that must work inside the browser sandbox. this is
  the product floor: setup -> interview (voice + text) -> report -> history
  -> coach all work here, complete, not a degraded mode.
- **enhanced** - sidecar-only capabilities that need a real process or
  filesystem: managed stt/tts engines, document ingestion/rag, local file
  tools. sidecar = core + enhancements, never a different product.

the current failure is not that browser lacks features - it is that browser
mode is a second codebase that silently diverged. fix direction: shared port
interfaces, two adapters per port, single code path for every screen.

## 1. the line - capability matrix

| capability | browser (core) | sidecar (enhanced) |
|---|---|---|
| session storage | opfs store | sqlite (app-support dir) |
| llm | managed demo endpoint (zero-conf) or byo | same + native anthropic flavor |
| stt | web speech api (chromium; degrade elsewhere) | managed .cpp preset or byo endpoint |
| tts | speechsynthesis + byo endpoint | managed .cpp preset or byo endpoint |
| barge-in | web speech interim results + grace | vad-driven (exists) |
| typed turns | yes | yes (route into live voiceloop) |
| report gen | client-side via llm port | server-side via llm port |
| history / coach / editor / whiteboard | yes | yes |
| document ingestion / rag | no - marked "sidecar only" in copy | yes |
| file tools / local paths | no | yes |

rule: a capability is "enhanced" only if it needs a process or the
filesystem. everything else ships in core. ui copy states sidecar-only
features explicitly instead of silently missing them.

## 2. seams - the abstractions

### 2.1 sessionstore port

```ts
interface SessionStore {
  listSessions(): Promise<SessionSummary[]>;
  readRecord(id: string): Promise<SessionRecord>;
  appendTurn(id: string, turn: TurnInput): Promise<Turn>;
  setStatus(id: string, status: SessionStatus): Promise<void>;
  saveReport(id: string, report: InterviewReport): Promise<void>;
  readReport(id: string): Promise<InterviewReport | null>;
}
```

- `OpfsStore` - one file per record under `sessions/`, live-state files in a
  sibling `meta/` dir, serialized writes per session id, `listSessions`
  filters by schema not by extension.
- `HttpStore` - maps onto the existing rest routes; sqlite stays
  server-internal.
- every screen reads through this port only. kills the pending-turns crash,
  lossy writes, missing hydration, and stuck `created` status in one move.

### 2.2 reportgenerator port

- `ClientGenerator` - existing `loadOrGenerateClientReport` path.
- `ServerGenerator` - new `POST /v1/sessions/:id/report` runs
  `buildReportPrompt` through the server llm, persists, returns. closes the
  biggest e2e hole (server mode currently has no report generator at all).

### 2.3 voicedriver contract

- `start()` must produce a kickoff turn (or document why none).
- `interrupt()` - server: vad (exists). browser: web speech `onresult`
  during `agentSpeaking` -> interrupt, with ~300ms continuation grace so
  backchannels do not kill playback.
- degraded states are first-class: `micDenied`, `sttUnavailable` -> ui
  offers text-first, never a dead mic button.
- `sendText` routes through the driver, not a write-only rest path.
- profile changes re-initialize the driver (currently captured at
  construction - silent staleness).

### 2.4 provider profile

- `apiKey` optional when `baseUrl` matches a managed/demo endpoint (schema
  change in shared/).
- per-field validation feedback instead of silently dropping sections.
- version the profile payload; migrate legacy on load.

## 3. zero-conf llm

goal: first run, zero config, working interview.

### phase a - dev (this repo)

- wire `$CAUCE_AI_API_KEY` / `$CAUCE_AI_BASE_URL` / `$CAUCE_AI_MODEL` into
  `scripts/dev-env.sh` (or a `dev:cauce` mise env) via the existing
  `DI_LLM__*` overrides - server config needs no schema change.
- browser zero-conf: relax `ProviderEndpointSchema.apiKey` for managed
  baseUrls, add a `demo` provider entry defaulting to the proxy url.
- mock provider gets real sse streaming so evals + e2e exercise the stream
  path.

### phase b - prod demo (vps proxy, quim's infra)

- rate-limited anonymous proxy on the vps; spa defaults llm to it when no
  profile configured. "demo mode" chip so it is legible, not invisible.
- keep the provider guidance (openrouter / groq / cerebras / ai studio
  links) - byo stays the upgrade path.
- "want unlimited zero-conf?" cta with click logging - cheap demand test
  before billing.
- degrade honestly: proxy down -> byo form, not a spinner.

## 4. desktop .cpp stt/tts preset - noted, not doing

parakeet.cpp-class stt + pocket-tts-class tts, small models, snappy on
low-resource devices, human-sounding voice. dev sidecars already exist
(`.di/process-compose.yaml` :9003/:9004/:9005). packaging + preset-config
job, not a new engine. recorded, not implemented unless asked.

## 5. phases

### p0 - make e2e possible in both modes

ordered by dependency; each ships green e2e for its path.

1. **history crash** - `listClientSessions` schema-filters `sessions/`;
   move `pending-turns-*.json`/`live-session.json` to `meta/`.
2. **server report generation** - `POST /v1/sessions/:id/report` via
   `ServerGenerator` (2.2). fixes the finish->404 dead end.
3. **typed turns reach the agent (server)** - route `sendText` into the
   live voiceloop; keep the rest row-write as the store write.
4. **probe content-type check** - `probeServer` must require JSON, not
   `res.ok`; SPA-fallback hosts otherwise false-positive into server mode
   and `start` throws a raw parse error. blocks all static deploys.
5. **question card populates** - render latest agent turn text in both
   modes (fallback when no `update_question` call).
6. **kickoff** - server: kick off on ws connect. browser: do not cancel
   kickoff on mic-permission failure; land user in text-first.
7. **double-speak** - remove the `seenTurns` re-speak effect or gate it to
   turns the driver has not spoken.
8. **browser barge-in** - web speech interim results during `agentSpeaking`
   -> `interrupt()`, ~300ms continuation grace.
9. **sessionstore port + adapters** (2.1) - per-turn atomic writes,
   hydration on mount (reload currently wipes the visible transcript),
   real seqs, real status transitions.

exit: scripted e2e interview completes and produces a report in both modes,
on a static deploy too.

### p1 - ux truth-telling

10. **runtime mode is a choice, not a probe result** - visible mode
    indicator + switcher instead of silent fallback.
11. **settings stops dropping config** - per-field validation, never
    discard a section silently; driver re-init on profile change.
12. **coach unlock** - remove hardcoded `disabled`; gate on first report
    existing (decided); fix the dead-end copy.
13. **fix the lies** - misleading provider-error copy on missing reports,
    silent ingestion pills, `degraded` badge honesty, countdown from
    `created_at` not mount time.
14. **voice->text degradation ux** - mic denied / non-chromium -> text-first
    offered, persisted as typed turns.

### p2 - zero-conf llm (section 3)

15. cauce env wiring + `demo` provider entry + schema relaxation.
16. demo-mode chip + "want unlimited zero-conf?" cta with click logging.
17. sse-capable mock provider.

### p3 - interview restructure (own phase)

scope: the ia inversion found in the ui audit - conversation must lead,
tools follow. more findings will land here, so it stays its own phase.

**gate: visual review before code.** before any merge, update
`.agents/docs/screens/*.md` ascii specs + render mockups/screenshots for
quim's sign-off.

18. **agentstage** - orb + status word + live caption in one zone; orb
    leaves the transcript rail. state word always accompanies the orb
    (orb-ui contract: state is semantic, volume is motion).
19. **controlbar** - sticky bottom cluster (mute, type-instead, end) at
    every viewport; pads `env(safe-area-inset-bottom)`.
20. **questioncard** - `QUESTION n/` progress chip + fallback text (p0-5).
21. **tooldock + toolspec registry** - `session.tools` becomes
    `Record<id,string>` with a `ToolSpec` registry
    (`agentAccess: read|write|read-write`); preset picks the toolset; >4
    tools -> `+` overflow picker. unblocks srs-cards-style tools.
22. **transcript** - rail on md+, bottom sheet below md; type input
    first-class ("talk or type..." model), not labeled a fallback.
23. **setup -> scenario card** - presets become scenario cards (narrative +
    goal checklist + start cta); knobs collapse into advanced; toolset
    preview chip.
24. **finish auto-advance** - report builds automatically post-interview
    with a "building your report" state; keep manual buttons.
25. **mobile polish batch** - touch targets >=44px, `viewport-fit=cover`,
    back-guard on interview exit, ended-session re-entry state, landing
    overflow fix @1024, hydration error #418.

### p4 - design system + stack verdicts

locked stack verdicts (adversarial stack audit - do not re-litigate):

- **stay on react 19 + tanstack + tailwind v4 + shadcn.** measured: classes
  are ~12% of .tsx tokens; svelte/solid ports score worse; rewrite is
  net-negative (3-5 agent-sessions).
- **semantic-class consolidation** - ~14% token cut by mapping repeated
  class sets onto semantic tokens; an afternoon pass, not a migration.
- **ark ui for new primitives** (hedge) - zag fsms port verbatim to
  solid/svelte if a migration ever happens.
- **xstate stays** - voice turn fsm earns it; setup correctly remains a form.
- **no daisyui/stylex/htmx/elm/rescript** - evidence-based disqualification.
- **tldraw pinned** - free for oss; planned later swap to a react-flow
  customization (same react ecosystem, no rewrite risk).

persist: `adr-0004-frontend-stack.md` records these + the measured data.

26. **DESIGN.md** - contract doc (~120 lines): taxonomy/rules/component
    recipes/do's-and-don'ts; `theme.css @theme` stays the normative token
    source (no value duplication).
27. **enforcement** - `dscheck` in T1 (decided): reads `@theme`, `--format
    agent` output naming the right token.
28. **fix `web/AGENTS.md` route list** - lists `/history` and `/editor`
    routes that do not exist (history is a settings pane; whiteboard is a
    tab). screens/ specs stay the convention.

### p5 - sidecar enhancements

29. server kickoff + events feed polish; ingestion marked "sidecar only".
30. tts wire dedup - drop `sendBinary` or the `{t:"tts"}` b64 frames
    (server currently sends both).
31. zombie voiceloop - capture first or close ws on getUserMedia failure.
32. app-support dir for sqlite on desktop.
33. .cpp stt/tts preset (section 4) - only when asked.

### p6 - test, docs & structure debt

34. e2e full-loop specs for both modes - current suite encodes brokenness
    as green.
35. knip fix (seed-demo entry + 5 stale ignores) - un-red ci.
36. stale docs rewrite (user-flows, stack, changelog - still describe the
    python/livekit app; docs README index lists phantom screens).
37. `apps/`+`packages/` move (decided) - one commit, move-map + follow-on
    edit checklist from the design-conventions research.

## 6. decisions (all answered)

- interview restructure = own phase, visual review (ascii + screenshots)
  required before merge.
- stack verdicts locked via adr-0004; hedges adopted (ark ui, semantic
  classes).
- tldraw not a blocker (free oss license); react-flow swap planned later.
- `apps/`+`packages/` move = yes.
- design enforcement = `dscheck` in T1.
- coach = gate on first report existing.
