import type { Session, Turn } from "@di/shared/session";
import type { Report } from "@di/shared/report";
import {
  appendClientTurn,
  createClientSession,
  saveClientReport,
  setClientSessionStatus,
} from "./opfs-store";

/**
 * Fake completed interview sessions seeded into OPFS by dev-fixtures.ts.
 * Not gated itself: all entry points live in dev-fixtures.ts.
 */

interface FixtureSpec {
  title: string;
  mode: Session["mode"];
  status: Session["status"];
  duration_min: number;
  ageHours: number;
  turns: Array<[speaker: Turn["speaker"], text: string]>;
  report?: Omit<Report, "session_id">;
}

const FIXTURES: FixtureSpec[] = [
  {
    title: "Frontend system design: collaborative canvas",
    mode: "interview",
    status: "reported",
    duration_min: 30,
    ageHours: 26,
    turns: [
      [
        "agent",
        "Walk me through how you would design a collaborative infinite canvas, like Figma. Focus on the sync layer.",
      ],
      [
        "user",
        "I would start with an operational transform or CRDT model for the document. Each object on the canvas gets a stable id, and edits are operations like move, resize, and re-order. A websocket channel fans ops out to peers, and each client applies them in a deterministic order.",
      ],
      ["agent", "How do you handle offline edits and reconnection?"],
      [
        "user",
        "Ops queue locally while offline. On reconnect we send our op log since the last acknowledged sequence number; the server collapses concurrent edits with a last-writer-wins rule per property, plus tombstones for deletes so reordering stays stable.",
      ],
      ["agent", "Good. What would you instrument to detect sync lag in production?"],
      [
        "user",
        "A per-op ack timestamp so we can chart p95 round-trip, plus a divergence counter when a client has to re-render from a server snapshot instead of applying an op.",
      ],
    ],
    report: {
      overall_score: 7.5,
      coverage_pct: 82,
      generated_at: "2026-01-01T10:00:00.000Z",
      competencies: [
        {
          name: "Distributed systems fundamentals",
          score: 8,
          evidence: [
            {
              quote: "ops queue locally while offline... the server collapses concurrent edits",
              turn_seq: 3,
              verdict: "worked",
            },
          ],
        },
        {
          name: "Observability",
          score: 7,
          evidence: [
            {
              quote: "a per-op ack timestamp so we can chart p95 round-trip",
              turn_seq: 5,
              verdict: "worked",
            },
          ],
        },
      ],
      model_answers: [
        {
          question_id: "3f1d2b9a-5c6e-4a7b-8d90-1e2f3a4b5c6d",
          question_text: "How do you handle offline edits and reconnection?",
          answer:
            "Queue ops locally with per-client sequence numbers; on reconnect, replay the log since the last ack and resolve conflicts deterministically (LWW per property with tombstones for deletes).",
        },
      ],
    },
  },
  {
    title: "Behavioral: shipping under deadline",
    mode: "coach",
    status: "finished",
    duration_min: 20,
    ageHours: 5,
    turns: [
      [
        "agent",
        "Tell me about a time you had to cut scope to hit a deadline. What did you drop, and why?",
      ],
      [
        "user",
        "We had a migration launch blocked on a reporting dashboard. I moved the dashboard to a CSV export for v1 and kept the schema migration, which was the risky part. The export shipped on time and nobody complained once the real dashboard landed two sprints later.",
      ],
      ["agent", "How did you communicate the scope cut to stakeholders?"],
      [
        "user",
        "I framed it as sequencing, not cutting: the data model was the long pole, the UI was not. I showed them the export in a demo before the deadline so there were no surprises.",
      ],
    ],
  },
  {
    title: "Debugging drill: memory leak in a long-lived SPA",
    mode: "interview",
    status: "finished",
    duration_min: 25,
    ageHours: 72,
    turns: [
      ["agent", "A single-page app slows down after an hour of use. How would you find the leak?"],
      [
        "user",
        "Heap snapshots at t0 and t60, compare retained sizes by constructor, and look for detached DOM trees or listeners holding closures. Allocation timelines help pinpoint what keeps growing.",
      ],
      [
        "agent",
        "Say you find event listeners registered on a shared emitter never being removed. How do you fix it without a big refactor?",
      ],
      [
        "user",
        "An AbortController per component scope: every subscribe call takes its signal, and unmount aborts, tearing down all subscriptions at once.",
      ],
    ],
  },
];

/** (Re)write all fixture sessions into OPFS. */
export async function seedFixtures(): Promise<string[]> {
  const ids: string[] = [];
  for (const spec of FIXTURES) {
    const session = await createClientSession({
      title: spec.title,
      mode: spec.mode,
      duration_min: spec.duration_min,
    });
    // createClientSession writes status "created"; normalize to the fixture's.
    session.status = spec.status;
    const sessionId = session.id;
    for (let i = 0; i < spec.turns.length; i++) {
      const [speaker, text] = spec.turns[i]!;
      const turn: Turn = {
        id: crypto.randomUUID(),
        session_id: sessionId,
        seq: i,
        speaker,
        text,
        created_at: new Date().toISOString(),
        source: speaker === "user" ? "voice" : "text",
      };
      await appendClientTurn(sessionId, turn);
    }
    await setClientSessionStatus(sessionId, spec.status);
    if (spec.report) {
      await saveClientReport(sessionId, { session_id: sessionId, ...spec.report });
    }
    ids.push(sessionId);
  }
  return ids;
}
