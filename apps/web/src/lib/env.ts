/**
 * Build-time numeric env reads (`VITE_*`), evaluated once at module scope.
 * Voice-pipeline thresholds and timeouts are tunable for evals/hardware
 * without a code change; unset or unparseable falls back to the default.
 */
export function envNum(name: string, fallback: number): number {
  const raw = (import.meta.env as Record<string, unknown>)[name];
  if (typeof raw !== "string" || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
