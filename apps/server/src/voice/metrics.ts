import type { TurnMetrics, VoiceServerMessage } from "@di/shared";

/** Turn start (utterance end) per metrics object, so latencies stay durations, not wall-clock stamps. */
const TURN_START = new WeakMap<TurnMetrics, number>();

/** Fresh metrics for a turn that started at `t0`. */
export function startTurnMetrics(t0: number, vadMs: number): TurnMetrics {
  const metrics: TurnMetrics = { vad_ms: vadMs, total_ms: 0 };
  TURN_START.set(metrics, t0);
  return metrics;
}

/** Record first_audio_ms once, as ms since the turn started. */
export function markFirstAudio(metrics: TurnMetrics): void {
  if (metrics.first_audio_ms !== undefined) return;
  metrics.first_audio_ms = Date.now() - (TURN_START.get(metrics) ?? Date.now());
}

/** Stamp total_ms and publish metrics unless the turn was interrupted. */
export function finishTurnMetrics(
  metrics: TurnMetrics,
  t0: number,
  signal: AbortSignal,
  sinks: {
    send: (msg: VoiceServerMessage) => void;
    postEvent: (type: string, payload?: unknown) => Promise<void>;
  },
): void {
  metrics.total_ms = Date.now() - t0;
  if (signal.aborted) return;
  sinks.send({ t: "metrics", metrics });
  sinks.postEvent("turn.metrics", metrics).catch(() => undefined);
}
