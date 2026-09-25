import * as v from "valibot";
import { TurnSchema } from "./session";

/**
 * Voice WebSocket message contracts for GET /v1/sessions/:id/voice.
 *
 * Transport is streaming (client pushes PCM frames as they are captured);
 * recognition is utterance-buffered: the client's VAD delimits utterances,
 * and the server transcribes each completed utterance with the buffered
 * OpenAI-compatible STT adapter. (WS is not represented in openapi.json.)
 *
 * Binary audio frames: raw PCM16 little-endian bytes with a 4-byte big-endian
 * seq prefix. JSON `audio` messages with base64 `pcm` are accepted as a
 * fallback. `tts` messages from the server use the same framing so b64 JSON
 * is a universal fallback.
 */

/** 4-byte BE seq + PCM16LE bytes. */
export const AUDIO_HEADER_BYTES = 4;

export const AudioFrameMessageSchema = v.object({
  t: v.literal("audio"),
  /** monotonic per-connection frame sequence */
  seq: v.pipe(v.number(), v.integer(), v.minValue(0)),
  /** base64-encoded PCM16LE mono 16k frame (fallback framing) */
  pcm: v.string(),
});
export type AudioFrameMessage = v.InferOutput<typeof AudioFrameMessageSchema>;

export const UtteranceEndMessageSchema = v.object({
  t: v.literal("utterance_end"),
});
export type UtteranceEndMessage = v.InferOutput<typeof UtteranceEndMessageSchema>;

export const MuteMessageSchema = v.object({
  t: v.literal("mute"),
  /** true = client muted; server drops buffered audio */
  muted: v.boolean(),
});
export type MuteMessage = v.InferOutput<typeof MuteMessageSchema>;

export const InterruptMessageSchema = v.object({
  t: v.literal("interrupt"),
});
export type InterruptMessage = v.InferOutput<typeof InterruptMessageSchema>;

export const AgentSpeakingMessageSchema = v.object({
  t: v.literal("agent_speaking"),
  on: v.boolean(),
});
export type AgentSpeakingMessage = v.InferOutput<typeof AgentSpeakingMessageSchema>;

export const UserTranscriptMessageSchema = v.object({
  t: v.literal("user_transcript"),
  turn: TurnSchema,
});
export type UserTranscriptMessage = v.InferOutput<typeof UserTranscriptMessageSchema>;

export const AgentTranscriptMessageSchema = v.object({
  t: v.literal("agent_transcript"),
  turn: TurnSchema,
});
export type AgentTranscriptMessage = v.InferOutput<typeof AgentTranscriptMessageSchema>;

export const TtsMessageSchema = v.object({
  t: v.literal("tts"),
  /** monotonic chunk sequence within the current agent utterance */
  seq: v.pipe(v.number(), v.integer(), v.minValue(0)),
  /** base64-encoded PCM16LE mono 24k chunk (fallback framing) */
  pcm: v.string(),
  /** true on the final chunk of the utterance */
  final: v.optional(v.boolean(), false),
});
export type TtsMessage = v.InferOutput<typeof TtsMessageSchema>;

export const ErrorMessageSchema = v.object({
  t: v.literal("error"),
  message: v.string(),
});
export type ErrorMessage = v.InferOutput<typeof ErrorMessageSchema>;

/** Per-turn latency measurements (ms), sent after the final tts chunk. */
export const TurnMetricsSchema = v.object({
  /** utterance duration (VAD end minus first speech frame) */
  vad_ms: v.number(),
  /** buffered STT transcription round-trip */
  stt_ms: v.optional(v.number()),
  /** time to first LLM token (streaming) or full completion */
  llm_ttft_ms: v.optional(v.number()),
  /** utterance end to first audio chunk sent */
  first_audio_ms: v.optional(v.number()),
  /** utterance end to final audio chunk sent */
  total_ms: v.number(),
});
export type TurnMetrics = v.InferOutput<typeof TurnMetricsSchema>;

export const MetricsMessageSchema = v.object({
  t: v.literal("metrics"),
  metrics: TurnMetricsSchema,
});
export type MetricsMessage = v.InferOutput<typeof MetricsMessageSchema>;

/** Client -> server WS messages (control plane; audio rides binary frames). */
export const VoiceClientMessageSchema = v.union([
  AudioFrameMessageSchema,
  UtteranceEndMessageSchema,
  MuteMessageSchema,
  InterruptMessageSchema,
]);
export type VoiceClientMessage = v.InferOutput<typeof VoiceClientMessageSchema>;

/** Server -> client WS messages. */
export const VoiceServerMessageSchema = v.union([
  AgentSpeakingMessageSchema,
  UserTranscriptMessageSchema,
  AgentTranscriptMessageSchema,
  TtsMessageSchema,
  ErrorMessageSchema,
  MetricsMessageSchema,
]);
export type VoiceServerMessage = v.InferOutput<typeof VoiceServerMessageSchema>;

/** Sample rates fixed by the pipeline: capture/STT 16k, TTS playback 24k. */
export const CAPTURE_SAMPLE_RATE = 16_000;
export const TTS_SAMPLE_RATE = 24_000;
