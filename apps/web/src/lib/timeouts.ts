/**
 * Central timeout budgets (ms). p0.3/p2.5: every unbounded await in the voice
 * and model paths is bounded by one of these; keep literals out of call sites.
 * Each budget has a VITE_* build-time override for packagers (envNum keeps
 * the default when unset); see .agents/plans/2026-09-28-configurable-constants.md.
 */
import { envNum } from "./env";

export const WS_OPEN_TIMEOUT_MS = envNum("VITE_WS_OPEN_TIMEOUT_MS", 10_000);

export const MODEL_LOAD_TIMEOUT_MS = envNum("VITE_MODEL_LOAD_TIMEOUT_MS", 10 * 60_000);

export const MODEL_DOWNLOAD_TIMEOUT_MS = envNum("VITE_MODEL_DOWNLOAD_TIMEOUT_MS", 10 * 60_000);

export const TTS_SENTENCE_TIMEOUT_MS = envNum("VITE_TTS_SENTENCE_TIMEOUT_MS", 15_000);

export const LLM_TURN_TIMEOUT_MS = envNum("VITE_LLM_TURN_TIMEOUT_MS", 90_000);

export const LLM_SMOKE_TEST_TIMEOUT_MS = envNum("VITE_LLM_SMOKE_TEST_TIMEOUT_MS", 90_000);

export const TTS_TEST_TIMEOUT_MS = envNum("VITE_TTS_TEST_TIMEOUT_MS", 5_000);
