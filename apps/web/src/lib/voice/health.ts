// voice health: a capped in-memory ring of pipeline timing/failure events
// (engine boot, stt first-partial latency, per-utterance tts synth, playback
// underrun gaps and truncation stops). captured in `$voiceHealth` and mirrored
// to `window.voiceHealth` in dev so failures are inspectable without relying
// on ear-testing.
import { atom } from "nanostores";

export type VoiceHealthKind =
  | "engine.boot"
  | "stt.firstPartial"
  | "tts.speak"
  | "playback.gap"
  | "playback.drained"
  | "playback.stop";

export interface VoiceHealthEvent {
  at: number;
  kind: VoiceHealthKind;
  ok: boolean;
  ms?: number;
  detail?: string;
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
