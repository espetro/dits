import { atom } from "nanostores";

/**
 * Live mic/agent loudness (0..1) for the voice orb. Written by the audio
 * paths (mic capture worklet frames, PCM playback writes), read per-frame
 * by the orb's volume getters so the WebGL animation never re-renders React.
 *
 * Envelopes decay here: audio paths only push attacks; the getters apply a
 * time-based release so the orb falls back to idle smoothly.
 */

export const $micAttack = atom(0);
export const $agentAttack = atom(0);

const RELEASE_MS = 220;

function decayed(attack: number, pushedAt: number, now: number): number {
  if (attack <= 0) return 0;
  const held = now - pushedAt;
  if (held <= 0) return attack;
  if (held >= RELEASE_MS) return 0;
  return attack * (1 - held / RELEASE_MS);
}

let micPushedAt = 0;
let agentPushedAt = 0;

export function pushMicLevel(rms: number): void {
  micPushedAt = performance.now();
  $micAttack.set(Math.min(1, Math.pow(rms, 0.5) * 2.5));
}

export function pushAgentLevel(rms: number): void {
  agentPushedAt = performance.now();
  $agentAttack.set(Math.min(1, Math.pow(rms, 0.5) * 2.5));
}

export function getMicLevel(): number {
  return decayed($micAttack.get(), micPushedAt, performance.now());
}

export function getAgentLevel(): number {
  return decayed($agentAttack.get(), agentPushedAt, performance.now());
}

/** React helper kept for API symmetry; getters are push-agnostic. */
export function useVoiceLevelTap(): void {}
