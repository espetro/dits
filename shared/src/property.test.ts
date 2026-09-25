import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import * as v from "valibot";
import { CreateSessionRequestSchema, SessionIdSchema, SessionSchema, TurnSchema } from "./session";
import { InterviewPlanSchema } from "./plan";
import { CompetencyScoreSchema, ReportSchema } from "./report";
import { ConfigSchema, describeConfigError } from "./config";

// Generators for the shared contract shapes. Duration/score bounds mirror the
// valibot pipes so generated valid instances sit inside them.
const isoDate = fc
  .integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2035, 11, 31) })
  .map((ms) => new Date(ms).toISOString());
const uuid = fc.uuid();
const nonEmpty = fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0);

const sessionArb = fc.record({
  id: uuid,
  title: nonEmpty,
  mode: fc.constantFrom("interview", "coach"),
  created_at: isoDate,
  status: fc.constantFrom("created", "interviewing", "finished", "reported", "discarded"),
  duration_min: fc.integer({ min: 5, max: 120 }),
});

const evidenceArb = fc.record({
  quote: nonEmpty,
  turn_seq: fc.integer({ min: 0, max: 1000 }),
  verdict: fc.constantFrom("worked", "improve", "drop"),
});

const competencyArb = fc.record({
  name: nonEmpty,
  score: fc.double({ min: 0, max: 10, noNaN: true }),
  evidence: fc.array(evidenceArb, { maxLength: 5 }),
});

const reportArb = fc.record({
  session_id: uuid,
  overall_score: fc.double({ min: 0, max: 10, noNaN: true }),
  coverage_pct: fc.double({ min: 0, max: 100, noNaN: true }),
  competencies: fc.array(competencyArb, { maxLength: 8 }),
  model_answers: fc.constant([]),
  generated_at: isoDate,
});

const planArb = fc.record({
  type: nonEmpty,
  duration_min: fc.integer({ min: 5, max: 120 }),
  tone: nonEmpty,
  difficulty: fc.constantFrom("easy", "medium", "hard"),
  language: nonEmpty,
  focus_areas: fc.array(fc.record({ tag: nonEmpty }), { maxLength: 6 }),
  questions: fc.array(
    fc.record({
      id: uuid,
      text: nonEmpty,
      hints: fc.option(fc.array(nonEmpty, { maxLength: 3 }), {
        nil: undefined,
      }),
    }),
    { maxLength: 10 },
  ),
});

describe("contract round-trip properties", () => {
  it("any generated valid session parses", () => {
    fc.assert(fc.property(sessionArb, (s) => v.is(SessionSchema, s)));
  });

  it("any generated valid report parses and preserves score", () => {
    fc.assert(
      fc.property(reportArb, (r) => {
        if (!v.is(ReportSchema, r)) return false;
        const parsed = v.parse(ReportSchema, r);
        return parsed.overall_score === r.overall_score && parsed.session_id === r.session_id;
      }),
    );
  });

  it("any generated valid plan parses", () => {
    fc.assert(fc.property(planArb, (p) => v.is(InterviewPlanSchema, p)));
  });

  it("creating a session request is accepted within bounds, rejected outside", () => {
    // table-driven: the explicit boundary set for the duration pipe
    const boundaries = [4, 5, 30, 120, 121];
    const mk = (duration_min: number) => ({
      title: "t",
      mode: "interview",
      duration_min,
    });
    expect(boundaries.filter((d) => v.is(CreateSessionRequestSchema, mk(d)))).toEqual([5, 30, 120]);

    fc.assert(
      fc.property(
        fc.integer({ min: -100, max: 1000 }),
        (d) => v.is(CreateSessionRequestSchema, mk(d)) === (d >= 5 && d <= 120),
      ),
    );
  });

  it("session id schema rejects malformed uuids", () => {
    const samples = ["", "not-a-uuid", "123", "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz"];
    expect(samples.every((s) => !v.is(SessionIdSchema, s))).toBe(true);
  });

  it("turns reject non-iso timestamps and out-of-range seq", () => {
    const turn = (over: { created_at?: string; seq?: number }) => ({
      id: crypto.randomUUID(),
      session_id: crypto.randomUUID(),
      seq: over.seq ?? 0,
      speaker: "user",
      text: "x",
      created_at: over.created_at ?? new Date().toISOString(),
      source: "text",
    });
    const cases = [turn({ created_at: "yesterday" }), turn({ seq: -1 }), turn({ seq: 1.5 })];
    expect(cases.every((t) => !v.is(TurnSchema, t))).toBe(true);
  });

  it("competency scores outside 0..10 are rejected", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -20, max: 20, noNaN: true }),
        (score) =>
          v.is(CompetencyScoreSchema, { name: "n", score, evidence: [] }) ===
          (score >= 0 && score <= 10),
      ),
    );
  });

  it("config errors always name a key path", () => {
    const badConfig = (port: unknown) => ({
      server: { port },
      llm: { provider: "mock", base_url: "http://x/v1", model: "m" },
      stt: { base_url: "http://x/v1", model: "m", mode: "buffered" },
      tts: { base_url: "http://x/v1", model: "m", voice: "v" },
    });
    fc.assert(
      fc.property(fc.constantFrom("oops", -1, 99999, null), (port) => {
        const r = v.safeParse(ConfigSchema, badConfig(port));
        if (r.success) return false;
        const msg = describeConfigError(r.issues);
        return msg.includes("config.") && msg.length > 0;
      }),
    );
  });
});
