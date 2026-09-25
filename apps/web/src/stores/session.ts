import { persistentAtom } from "@nanostores/persistent";
import { atom, map } from "nanostores";

export type SessionStatus = "created" | "interviewing" | "finished" | "reported" | "discarded";

export interface SessionDraft {
  title: string;
  mode: "interview" | "coach";
  durationMin: number;
  tone: string;
  difficulty: string;
  language: string;
  prompt: string;
}

/** Setup form draft — ephemeral, lost on submit by design. */
export const $draft = map<SessionDraft>({
  title: "",
  mode: "interview",
  durationMin: 30,
  tone: "friendly",
  difficulty: "medium",
  language: "en",
  prompt: "",
});

/** Active session id once created; URL param remains source of truth on session routes. */
export const $sessionId = atom<string | null>(null);

/** Latest pruned whiteboard snapshot JSON (serialized), for the worker's read_whiteboard tool. */
export const $whiteboard = atom<string>("{}");

/** Current editor buffer text, for the worker's read_editor tool. */
export const $editorBuffer = atom<string>("");

/** Interview live state mirrored from the agent (question block is agent-editable). */
export const $question = map<{ text: string; hints: string[] }>({
  text: "",
  hints: [],
});

/** Count of question updates this session — drives the QUESTION n chip (p3-20). */
export const $questionCount = atom(0);

/** Set the live question and bump the counter. */
export function setQuestion(q: { text: string; hints: string[] }): void {
  $question.set(q);
  if (q.text) $questionCount.set($questionCount.get() + 1);
}

/** Reset question state on (re)hydration without counting it. */
export function resetQuestion(): void {
  $question.set({ text: "", hints: [] });
  $questionCount.set(0);
}

/** Transcript panel expanded state. Minimize never hides the panel (peek rail). */
export const $transcriptOpen = atom(true);

/** Microphone muted state. */
export const $muted = atom(false);

/** UI locale, persisted. Interview language is a separate config field. */
export const $locale = persistentAtom<string>("di:locale", "en");

/** Editor language for syntax highlighting. Persisted; markdown default for non-technical users. */
export const $editorLanguage = persistentAtom<string>("di:editor:language", "markdown");

/** Editor theme, independent of the app theme. Persisted. */
export const $editorTheme = persistentAtom<"light" | "dark">("di:editor:theme", "dark");

/** Locales shipped in apps/web/src/locales. */
export const LOCALES = ["en", "de", "es", "fr", "ja", "pt-BR", "zh-CN", "ko", "it", "ar"] as const;

/** Locales rendered right-to-left. */
export const RTL_LOCALES: readonly string[] = ["ar"];
