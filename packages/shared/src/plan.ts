import * as v from "valibot";

export const FocusAreaSchema = v.object({
  tag: v.string(),
  weight: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(1))),
});
export type FocusArea = v.InferOutput<typeof FocusAreaSchema>;

/** Structured output of the (M4) validate step; carried on the session in M1. */
export const InterviewPlanSchema = v.object({
  type: v.string(),
  duration_min: v.pipe(v.number(), v.integer(), v.minValue(5), v.maxValue(120)),
  tone: v.string(),
  difficulty: v.picklist(["easy", "medium", "hard"]),
  language: v.string(),
  focus_areas: v.array(FocusAreaSchema),
  source_facts: v.optional(v.array(v.string())),
  questions: v.array(
    v.object({
      id: v.pipe(v.string(), v.uuid()),
      text: v.string(),
      hints: v.optional(v.array(v.string())),
    }),
  ),
});
export type InterviewPlan = v.InferOutput<typeof InterviewPlanSchema>;
