/**
 * Typed `VITE_*` readers: `envNum("VITE_X", 5)` returns 5 unless the build
 * carried a VITE_X override. These are build-time (packager) knobs — the
 * shipped bundle is baked into the `di` binary, so end users cannot set
 * them post-build (see .agents/plans/2026-09-28-configurable-constants.md).
 * The env map is injectable for tests; `import.meta.env` is a static
 * record, not process.env.
 */

export interface EnvSource {
  readonly [key: string]: unknown;
}

export function envStr(name: string, fallback: string, env: EnvSource = import.meta.env): string {
  const value = env[name];
  return typeof value === "string" && value !== "" ? value : fallback;
}

export function envNum(name: string, fallback: number, env: EnvSource = import.meta.env): number {
  const value = env[name];
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function envBool(
  name: string,
  fallback: boolean,
  env: EnvSource = import.meta.env,
): boolean {
  const value = env[name];
  if (value === undefined || value === "") return fallback;
  return value === true || value === "true" || value === "1";
}
