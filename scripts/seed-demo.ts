#!/usr/bin/env bun
/**
 * Seeds a demo session (turns + report + tools) through the server REST API so
 * the history, interview, and report pages have content on camera. Idempotent:
 * reuses an existing session with the same title and only seeds turns when its
 * transcript is empty. Requires a running DI server (DI_URL, default
 * http://localhost:3000); test mode is only needed for the smoke route, not here.
 */
import * as v from "../shared/node_modules/valibot/dist/index.mjs";
import {
  ReportSchema,
  SessionSchema,
  ToolStateSchema,
  TurnSchema,
  type Session,
} from "../shared/src/index";

const BASE = process.env.DI_URL ?? "http://localhost:3000";
const TITLE = "senior frontend mock interview";

async function api(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${BASE}/v1${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!res.ok)
    throw new Error(`${init?.method ?? "GET"} /v1${path} -> ${res.status}: ${await res.text()}`);
  return res;
}

function findSession(sessions: unknown): Session | undefined {
  return v.parse(v.array(SessionSchema), sessions).find((s) => s.title === TITLE);
}

async function postTurn(sessionId: string, turn: unknown): Promise<void> {
  await api(`/sessions/${sessionId}/turns`, { method: "POST", body: JSON.stringify(turn) });
}

async function seed(): Promise<void> {
  const existing = findSession(await (await api("/sessions")).json());
  const session =
    existing ??
    v.parse(
      SessionSchema,
      await (
        await api("/sessions", {
          method: "POST",
          body: JSON.stringify({ title: TITLE, mode: "interview", duration_min: 30 }),
        })
      ).json(),
    );
  if (existing) console.log(`reusing session ${session.id} (title match)`);

  const turns = v.parse(
    v.array(TurnSchema),
    await (await api(`/sessions/${session.id}/turns`)).json(),
  );
  if (turns.length === 0) {
    const start = Date.now() - 30 * 60_000; // spread over the 30-min window
    const lines: ["user" | "agent", string][] = [
      [
        "agent",
        "Welcome! Let's start with something recent: walk me through a frontend project you're proud of and what your specific contribution was.",
      ],
      [
        "user",
        "Sure. Last year I led the migration of our checkout flow from a legacy jQuery app to React with TypeScript. I owned the architecture: we split it into a design-system package and feature modules, and I set up the CI type checks that kept the migration incremental.",
      ],
      [
        "agent",
        "Nice. How did you handle regressions during that migration, given both stacks were live at once?",
      ],
      [
        "user",
        "We ran the two side by side behind feature flags per checkout step, so each migrated step got real traffic. I added Playwright e2e coverage for the shared happy path first, then per-step visual regression snapshots before touching any code.",
      ],
      [
        "agent",
        "Let's go a bit deeper on rendering performance. A dashboard page of ours takes 4 seconds to become interactive. How would you approach it?",
      ],
      [
        "user",
        "I'd profile first with the performance panel to separate network, hydration, and render cost. Usually the wins are code-splitting below the fold, deferring non-critical data fetches after first paint, and virtualizing long lists. I'd set a perf budget in CI so it can't quietly regress again.",
      ],
      [
        "agent",
        "Good. Last one: describe a time you disagreed with a teammate about a technical decision. What happened?",
      ],
      [
        "user",
        "A teammate wanted to adopt a state library mid-project while I preferred built-in context plus query caching. We agreed to timebox a spike, benchmarked the bundle cost and dev experience, and shipped the simpler option. The disagreement stayed about the code, not the people.",
      ],
      [
        "agent",
        "That's a solid close. Thanks for your time, we'll follow up with detailed feedback.",
      ],
    ];
    let seq = 0;
    for (const [speaker, text] of lines) {
      await postTurn(session.id, {
        id: crypto.randomUUID(),
        seq: seq++,
        speaker,
        text,
        created_at: new Date(start + seq * 165_000).toISOString(),
        source: "voice",
      });
    }
    console.log(`seeded ${seq} turns`);
  } else {
    console.log(`transcript already has ${turns.length} turns, skipping turn seed`);
  }

  const report = v.parse(ReportSchema, {
    session_id: session.id,
    overall_score: 7.5,
    coverage_pct: 82,
    competencies: [
      {
        name: "React architecture",
        score: 8,
        evidence: [
          {
            quote: "split it into a design-system package and feature modules",
            turn_seq: 1,
            verdict: "worked",
          },
          { quote: "feature flags per checkout step", turn_seq: 3, verdict: "worked" },
        ],
      },
      {
        name: "Performance",
        score: 7,
        evidence: [
          {
            quote: "code-splitting below the fold, deferring non-critical data fetches",
            turn_seq: 5,
            verdict: "worked",
          },
          {
            quote: "I'd profile first with the performance panel",
            turn_seq: 5,
            verdict: "improve",
          },
        ],
      },
      {
        name: "Collaboration",
        score: 8,
        evidence: [
          { quote: "timebox a spike, benchmarked the bundle cost", turn_seq: 7, verdict: "worked" },
        ],
      },
    ],
    model_answers: [
      {
        question_id: crypto.randomUUID(),
        question_text: "How would you make a dashboard interactive in under a second?",
        answer:
          "Profile to attribute cost, then code-split below the fold, defer secondary fetches, virtualize lists, and enforce a perf budget in CI.",
      },
    ],
    generated_at: new Date().toISOString(),
  });
  await api(`/sessions/${session.id}/report`, { method: "PUT", body: JSON.stringify(report) });

  const tools = v.parse(ToolStateSchema, {
    editor: `// debounced search hook discussed in the interview
function useDebouncedSearch<T>(query: string, fetcher: (q: string) => Promise<T[]>, ms = 300) {
  const [results, setResults] = useState<T[]>([]);
  useEffect(() => {
    const ac = new AbortController();
    const t = setTimeout(async () => {
      try { setResults(await fetcher(query)); } catch (e) { if (!ac.signal.aborted) throw e; }
    }, ms);
    return () => { clearTimeout(t); ac.abort(); };
  }, [query, ms]);
  return results;
}`,
    whiteboard: `# Perf budget plan (dashboard)
- TTI 4.0s -> 1.2s
- code-split: /reports, /settings (lazy routes)
- defer: analytics + notifications after LCP
- virtualize: 10k-row table -> @tanstack/virtual
- CI budget: lighthouse CI, fail on TTI > 1.5s`,
  });
  await api(`/sessions/${session.id}/tools`, { method: "PUT", body: JSON.stringify(tools) });

  console.log(`session: ${session.id}`);
  console.log(`open: /interview/${session.id}`);
}

await seed();
