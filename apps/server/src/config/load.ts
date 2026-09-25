import * as v from "valibot";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "yaml";
import {
  CONFIG_ENV_PREFIX,
  CONFIG_ENV_SEPARATOR,
  ConfigSchema,
  describeConfigError,
} from "@di/shared";
import type { Config } from "@di/shared";

export class ConfigError extends Error {}

/**
 * Deep-merge env overrides (DI_LLM__API_KEY style) onto the parsed yaml object
 * before validation, so fail-fast errors name the effective value's key.
 */
function applyEnvOverrides(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = structuredClone(raw);
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith(CONFIG_ENV_PREFIX) || value === undefined) continue;
    const path = key
      .slice(CONFIG_ENV_PREFIX.length)
      .split(CONFIG_ENV_SEPARATOR)
      .map((p) => p.toLowerCase());
    if (path.length === 0 || path[0] === "") continue;
    let node = out;
    for (const part of path.slice(0, -1)) {
      if (typeof node[part] !== "object" || node[part] === null) node[part] = {};
      node = node[part] as Record<string, unknown>;
    }
    const leaf = path[path.length - 1]!;
    node[leaf] = maybeNumber(value);
  }
  return out;
}

function maybeNumber(s: string): string | number {
  return /^\d+$/.test(s) ? Number(s) : s;
}

/** Load + validate config. Throws ConfigError naming the exact bad key. */
export function loadConfig(path: string): Config {
  if (!existsSync(path)) {
    throw new ConfigError(`config file not found: ${path}`);
  }
  let raw: unknown;
  try {
    raw = parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new ConfigError(`config file is not valid yaml: ${path} (${String(e)})`);
  }
  const withEnv = applyEnvOverrides(raw as Record<string, unknown>);
  const result = v.safeParse(ConfigSchema, withEnv);
  if (!result.success) {
    throw new ConfigError(`invalid config:\n${describeConfigError(result.issues)}`);
  }
  return result.output;
}
