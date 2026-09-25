import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";
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
  try {
    config = loadConfig(values.config!);
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(e.message);
      return 1;
    }
    throw e;
  }
  console.log(`[di] config ok (${values.config})`);

  if (values.check) {
    return check(config, values.config!);
  }

  const db = createDatabase(config.files.db_path);
  await migrate(db);
  const testMode = process.env.DI_TEST_MODE === "1";

  let webAssets;
  const spaDir = releaseAssetDir(join("web", "dist", "client"));
  if (existsSync(join(spaDir, "index.html"))) {
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
  const spaDir = releaseAssetDir("web/dist/client");
  const spaOk = existsSync(join(spaDir, "index.html"));
  results.push([
    "web assets",
    spaOk,
    spaOk ? spaDir : `${spaDir}/index.html not found (run: mise run build)`,
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
    results.push([`${name} provider`, ok, config.llm.base_url]);
  }

  const allOk = results.every(([, ok]) => ok);
  console.log("[di --check]");
  for (const [name, ok, msg] of results) {
    console.log(`  ${ok ? "ok" : "FAIL"}  ${name}${msg ? ` (${msg})` : ""}`);
  }
  console.log(`[di --check] ${allOk ? "all good" : "problems found"}`);
  return allOk ? 0 : 1;
}

/**
 * Resolve a bundled asset dir. In a release archive the layout is:
 *   di          (compiled binary)
 *   worker/worker.js
 *   web/dist/client/...
 * In a repo checkout everything resolves relative to this source file.
 */
function releaseAssetDir(rel: string): string {
  // Bun sets import.meta.dir to the dir of the executing script; in a
  // `bun build --compile` binary it is a virtual path, so prefer cwd first.
  // In a repo checkout the assets live at the repo root, which may be one or
  // two levels above cwd (e.g. when run from server/).
  const bases = [process.cwd(), import.meta.dir, `${process.cwd()}/..`, `${import.meta.dir}/..`];
  for (const base of bases) {
    const candidate = join(base, rel);
    if (existsSync(candidate)) return candidate;
  }
  return join(process.cwd(), rel);
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
