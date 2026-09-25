import * as v from "valibot";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

/**
 * Platform app-support dir for sidecar/desktop installs that omit `files.*`
 * (~/Library/Application Support/di, %APPDATA%/di, $XDG_DATA_HOME/di or
 * ~/.local/share/di). A bare `bun run server` run from anywhere gets stable
 * paths instead of littering the cwd.
 */
function defaultFilesDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  if (process.platform === "darwin") return join(home, "Library", "Application Support", "di");
  if (process.platform === "win32") return join(process.env.APPDATA ?? home, "di");
  return join(process.env.XDG_DATA_HOME ?? join(home, ".local", "share"), "di");
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
  const obj = raw as Record<string, unknown>;
  // `files` is optional in config: defaults land in the platform data dir,
  // explicit keys and DI_FILES__* env overrides still win. A non-object
  // value is left alone so schema validation still rejects it.
  const dir = defaultFilesDir();
  const defaults = {
    db_path: join(dir, "di.db"),
    log_path: join(dir, "di.log"),
    data_dir: join(dir, "data"),
  };
  if (obj.files === undefined) {
    obj.files = defaults;
  } else if (typeof obj.files === "object" && obj.files !== null) {
    obj.files = { ...defaults, ...obj.files };
  }
  const withEnv = applyEnvOverrides(obj);
  const result = v.safeParse(ConfigSchema, withEnv);
  if (!result.success) {
    throw new ConfigError(`invalid config:\n${describeConfigError(result.issues)}`);
  }
  return result.output;
}
