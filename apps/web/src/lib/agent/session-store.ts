import { atom, map } from "nanostores";
import type { Turn } from "@di/shared/session";

/**
 * Client-only session state: with no server to persist turns, the interview
 * accumulates them here (shared TurnSchema shape, monotonic seq) for the
 * transcript UI and later OPFS persistence + report generation.
 */

export const $currentQuestion = map<{ text: string; hints: string[] }>({
  text: "",
  hints: [],
});

/** All turns of the active client-only session, in seq order. */
export const $clientTurns = atom<Turn[]>([]);

export function resetClientSession(): void {
  $currentQuestion.set({ text: "", hints: [] });
  $clientTurns.set([]);
}

/** Push an already-built Turn (e.g. from BrowserVoiceDriver's speech/text events). */
export function pushClientTurn(turn: Turn): void {
  $clientTurns.set([...$clientTurns.get(), turn]);
}

export function appendTurn(
  sessionId: string,
  speaker: "user" | "agent",
  text: string,
  source: "voice" | "text" = "voice",
): Turn {
  const prev = $clientTurns.get();
  const turn: Turn = {
    id: crypto.randomUUID(),
    session_id: sessionId,
    seq: prev.length > 0 ? prev[prev.length - 1]!.seq + 1 : 0,
    speaker,
    text,
    created_at: new Date().toISOString(),
    source,
  };
  $clientTurns.set([...prev, turn]);
  return turn;
}
