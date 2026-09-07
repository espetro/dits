/**
 * Central timeout budgets (ms). p0.3/p2.5: every unbounded await in the voice
 * and model paths is bounded by one of these; keep literals out of call sites.
 */

export const WS_OPEN_TIMEOUT_MS = 10_000;

export const MODEL_LOAD_TIMEOUT_MS = 10 * 60_000;

export const MODEL_DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

export const TTS_SENTENCE_TIMEOUT_MS = 15_000;

export const LLM_TURN_TIMEOUT_MS = 90_000;

export const LLM_SMOKE_TEST_TIMEOUT_MS = 90_000;

export const TTS_TEST_TIMEOUT_MS = 5_000;
