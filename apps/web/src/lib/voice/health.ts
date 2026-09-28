// voice health: a capped in-memory ring of pipeline timing/failure events
// (engine boot, stt first-partial latency, per-utterance tts synth, playback
// underrun gaps and truncation stops). captured in `$voiceHealth` and mirrored
// to `window.voiceHealth` in dev so failures are inspectable without relying
// on ear-testing.
import { atom } from "nanostores";

export type VoiceHealthKind =
  | "engine.boot"
  | "worker.error"
  | "stt.firstPartial"
  | "stt.feed"
  | "stt.flush"
  | "tts.speak"
  | "playback.gap"
  | "playback.drained"
  | "playback.stop"
  | "gate";

export interface VoiceHealthEvent {
  at: number;
  kind: VoiceHealthKind;
  ok: boolean;
  ms?: number;
  detail?: string;
  /** gate events: the playback echo gate was active (always true today) */
  duringPlayback?: boolean;
  /** gate events: silero speech prob of the vad frame, when known */
  vadProb?: number;
  /** gate events: whether the speech evidence was allowed through */
  allowed?: boolean;
}

const CAP = 300;

export const $voiceHealth = atom<VoiceHealthEvent[]>([]);

export function pushVoiceHealth(event: Omit<VoiceHealthEvent, "at">): void {
  const entry: VoiceHealthEvent = { ...event, at: Date.now() };
  const next = [...$voiceHealth.get(), entry].slice(-CAP);
  $voiceHealth.set(next);
  if (import.meta.env.DEV) {
    (globalThis as { voiceHealth?: VoiceHealthEvent[] }).voiceHealth = next;
  }
}
