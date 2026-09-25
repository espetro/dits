import * as v from "valibot";
import type { Turn } from "./session";

export const CompetencyScoreSchema = v.object({
  name: v.string(),
  score: v.pipe(v.number(), v.minValue(0), v.maxValue(10)),
  evidence: v.array(
    v.object({
      quote: v.string(),
      turn_seq: v.pipe(v.number(), v.integer(), v.minValue(0)),
      verdict: v.picklist(["worked", "improve", "drop"]),
    }),
  ),
});
export type CompetencyScore = v.InferOutput<typeof CompetencyScoreSchema>;

export const ModelAnswerSchema = v.object({
  question_id: v.pipe(v.string(), v.uuid()),
  question_text: v.string(),
  answer: v.string(),
});
export type ModelAnswer = v.InferOutput<typeof ModelAnswerSchema>;

/** Port of the legacy ScoreCard shape minus LanguageReport and next_steps. */
export const ReportSchema = v.object({
  session_id: v.pipe(v.string(), v.uuid()),
  overall_score: v.pipe(v.number(), v.minValue(0), v.maxValue(10)),
  coverage_pct: v.pipe(v.number(), v.minValue(0), v.maxValue(100)),
  competencies: v.array(CompetencyScoreSchema),
  model_answers: v.array(ModelAnswerSchema),
  /** ISO 8601 */
  generated_at: v.pipe(v.string(), v.isoTimestamp()),
});
export type Report = v.InferOutput<typeof ReportSchema>;

export interface ReportPromptContext {
  sessionId: string;
  title: string;
  mode: string;
  turns: Turn[];
}

/**
 * Prompt for scoring a finished interview transcript into ReportSchema's
 * shape. Designed fresh for this branch: the server never generated reports
 * (routes.ts only stores/retrieves a client-supplied report), so there is no
 * existing prompt to reuse — this is the first one, shared so a future
 * server-side generator would use the exact same contract.
 */
export function buildReportPrompt(ctx: ReportPromptContext): string {
  const transcript = ctx.turns.map((t) => `[${t.seq}] ${t.speaker}: ${t.text}`).join("\n");
  return [
    "You are scoring a completed interview transcript against a rubric of the",
    "candidate's demonstrated competencies. Be specific and evidence-based:",
    "every claim must cite a transcript turn by its seq number.",
    `Interview mode: ${ctx.mode}.`,
    `Interview: ${ctx.title}.`,
    "",
    "Transcript:",
    transcript || "(empty transcript)",
    "",
    `session_id: ${ctx.sessionId}`,
    "",
    "Produce a report with: overall_score (0-10), coverage_pct (0-100, how much",
    "of the plan the interview actually covered), one competency entry per",
    "distinct skill demonstrated (each with a 0-10 score and evidence quotes",
    'tagged "worked", "improve" or "drop"), and model_answers for any question',
    "the candidate struggled with, showing what a strong answer looks like.",
    "generated_at must be the current ISO 8601 timestamp.",
  ].join("\n");
}
