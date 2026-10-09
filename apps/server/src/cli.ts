import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createDatabase, migrate, ping } from "./store/db";
import { ConfigError, loadConfig } from "./config/load";
import { probeProviders } from "./check/probe";
import { createApp, serveApp } from "./api/app";

export async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      check: { type: "boolean", default: false },
      config: { type: "string", default: "config.yaml" },
    },
  });

  let config;
  const configPath = resolveConfigPath(values.config!);
  try {
    config = loadConfig(configPath);
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(e.message);
      return 1;
    }
    throw e;
  }
  console.log(`[di] config ok (${configPath})`);

  if (values.check) {
    return check(config, configPath);
  }

  const db = createDatabase(config.files.db_path);
  await migrate(db);
  const testMode = process.env.DI_TEST_MODE === "1";

  let webAssets;
  const spaDir = releaseAssetDir();
  if (spaDir) {
    webAssets = { root: spaDir, path: "" };
  }

  const app = await createApp({ config, db, testMode, webAssets });
  const server = serveApp(app, config.server.port, { config, db });
  console.log(
    `[di] listening on http://localhost:${config.server.port}${testMode ? " (test mode)" : ""}`,
  );

  const shutdown = async () => {
    console.log("\n[di] shutting down");
    server.stop(true);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGHUP", () => void shutdown());
  process.on("unhandledRejection", (reason) => {
    console.error(
      JSON.stringify({
        event: "server_fatal",
        kind: "unhandledRejection",
        message: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
        ts: new Date().toISOString(),
      }),
    );
  });
  process.on("uncaughtException", (err) => {
    console.error(
      JSON.stringify({
        event: "server_fatal",
        kind: "uncaughtException",
        message: err.message,
        stack: err.stack,
        ts: new Date().toISOString(),
      }),
    );
    server.stop(true);
    process.exit(1);
  });
  // Keep the event loop alive while the server runs; shutdown() exits.
  await new Promise<never>(() => {});
  return 0; // unreachable, satisfies noImplicitReturns
}

async function check(
  config: Awaited<ReturnType<typeof loadConfig>>,
  configPath: string,
): Promise<number> {
  const results: Array<[string, boolean, string]> = [];

  // Config was already loaded by main() before reaching here.
  results.push(["config", true, configPath]);

  // Web SPA assets must be present next to the binary (release layout) or in
  // the repo checkout (dev layout).
  const spaDir = releaseAssetDir();
  results.push([
    "web assets",
    spaDir !== undefined,
    spaDir ?? "index.html not found next to the binary or under the cwd",
  ]);

  // SQLite database: create/open and ping it (also proves the directory is writable).
  let dbOk = false;
  let dbMsg: string;
  try {
    const db = createDatabase(config.files.db_path);
    dbOk = await ping(db);
    dbMsg = config.files.db_path;
  } catch (e) {
    dbMsg = e instanceof Error ? e.message : String(e);
  }
  results.push(["sqlite db", dbOk, dbMsg]);

  const providers = await probeProviders(config);
  for (const [name, ok] of Object.entries(providers)) {
    const endpoint = name === "llm" || name === "stt" || name === "tts" ? config[name] : undefined;
    results.push([`${name} provider`, ok, endpoint?.base_url ?? ""]);
  }

  const allOk = results.every(([, ok]) => ok);
  console.log("[di --check]");
  for (const [name, ok, msg] of results) {
    console.log(`  ${ok ? "ok" : "FAIL"}  ${name}${msg ? ` (${msg})` : ""}`);
  }
  console.log(`[di --check] ${allOk ? "all good" : "problems found"}`);
  return allOk ? 0 : 1;
}

const SPA_CANDIDATES = [join("web", "dist", "client"), join("apps", "web", "dist", "client")];

/**
 * When the requested config path doesn't exist (e.g. `mise exec
 * github:espetro/dits -- di` run from an unrelated cwd), look beside the
 * binary for config.yaml, then the bundled config.example.yaml.
 */
function resolveConfigPath(requested: string): string {
  if (existsSync(requested)) return requested;
  const binDir = dirname(process.execPath);
  for (const name of [basename(requested), "config.example.yaml"]) {
    const candidate = join(binDir, name);
    if (existsSync(candidate)) return candidate;
  }
  return requested;
}

/**
 * Resolve the bundled SPA dir, or undefined when absent. Bases: the cwd (one
 * or two levels from the repo root), the real executable dir (process.execPath
 * is the actual binary in a `bun build --compile` release — import.meta.dir is
 * a virtual /$bunfs path there — which is where `mise exec` installs the
 * assets), and the source file's dir for repo checkouts.
 */
function releaseAssetDir(): string | undefined {
  const bases = [process.cwd(), dirname(process.execPath), import.meta.dir];
  for (const base of bases) {
    for (const up of ["", "..", join("..", "..")]) {
      for (const rel of SPA_CANDIDATES) {
        const candidate = join(base, up, rel);
        if (existsSync(join(candidate, "index.html"))) return candidate;
      }
    }
  }
  return undefined;
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
