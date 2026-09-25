import * as v from "valibot";

export const SessionIdSchema = v.pipe(v.string(), v.uuid());
export type SessionId = v.InferOutput<typeof SessionIdSchema>;

export const SessionStatusSchema = v.picklist([
  "created",
  "interviewing",
  "finished",
  "reported",
  "discarded",
]);
export type SessionStatus = v.InferOutput<typeof SessionStatusSchema>;

export const InterviewModeSchema = v.picklist(["interview", "coach"]);
export type InterviewMode = v.InferOutput<typeof InterviewModeSchema>;

export const TurnSpeakerSchema = v.picklist(["user", "agent"]);
export type TurnSpeaker = v.InferOutput<typeof TurnSpeakerSchema>;

/** One transcript turn. Text input and voice input both produce Turns. */
export const TurnSchema = v.object({
  id: v.pipe(v.string(), v.uuid()),
  session_id: SessionIdSchema,
  seq: v.pipe(v.number(), v.integer(), v.minValue(0)),
  speaker: TurnSpeakerSchema,
  text: v.string(),
  /** ISO 8601 */
  created_at: v.pipe(v.string(), v.isoTimestamp()),
  source: v.picklist(["voice", "text"]),
});
export type Turn = v.InferOutput<typeof TurnSchema>;

export const SessionSchema = v.object({
  id: SessionIdSchema,
  title: v.pipe(v.string(), v.minLength(1)),
  mode: InterviewModeSchema,
  /** ISO 8601 */
  created_at: v.pipe(v.string(), v.isoTimestamp()),
  status: SessionStatusSchema,
  /** planned duration in minutes */
  duration_min: v.pipe(v.number(), v.integer(), v.minValue(5), v.maxValue(120)),
  plan: v.optional(v.string()),
});
export type Session = v.InferOutput<typeof SessionSchema>;

export const CreateSessionRequestSchema = v.object({
  title: v.pipe(v.string(), v.minLength(1)),
  mode: InterviewModeSchema,
  duration_min: v.pipe(v.number(), v.integer(), v.minValue(5), v.maxValue(120)),
  prompt: v.optional(v.string()),
});
export type CreateSessionRequest = v.InferOutput<typeof CreateSessionRequestSchema>;

/** Browser-pushed editor/whiteboard state the worker reads via GET /v1/sessions/:id/tools. */
export const ToolStateSchema = v.object({
  editor: v.string(),
  whiteboard: v.string(),
});
export type ToolState = v.InferOutput<typeof ToolStateSchema>;

/** Worker -> server session event, appended to the event log surfaced at /v1/test/events. */
export const SessionEventSchema = v.object({
  session_id: SessionIdSchema,
  type: v.string(),
  payload: v.optional(v.unknown()),
  /** ISO 8601 */
  at: v.pipe(v.string(), v.isoTimestamp()),
});
export type SessionEvent = v.InferOutput<typeof SessionEventSchema>;
