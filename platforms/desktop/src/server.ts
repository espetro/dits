import { existsSync } from "node:fs";
import { createConnection } from "node:net";
import { resolve } from "node:path";

import { createApp, serveApp } from "@di/server/api/app";
import { loadConfig } from "@di/server/config/load";
import { createDatabase, migrate } from "@di/server/store/db";
import type { Db } from "@di/server/store/db";

import { appendLog, setLogFile } from "./logbuffer";

interface RunningServer {
  server: ReturnType<typeof Bun.serve>;
  db: Db;
  port: number;
}

let current: RunningServer | null = null;
let configPath: string | null = null;
let starting: Promise<number> | null = null;

export function setConfigPath(path: string): void {
  configPath = path;
}

export function getConfigPath(): string | null {
  return configPath;
}

/**
 * Configured log file path from the current config.yaml, or null when the
 * config is unreadable/invalid or log_path is disabled (""). The dashboard
 * surfaces this so users (and their agents) know where the debug log lands.
 */
export function configuredLogPath(): string | null {
  if (!configPath) return null;
  try {
    const path = loadConfig(configPath).files.log_path;
    return path || null;
  } catch {
    return null;
  }
}

/**
 * Locate the built SPA. Bundled: electrobun `copy` puts apps/web/dist/client
 * at <app>/views/web next to the bun entrypoint. Dev/repo: resolve
 * apps/web/dist/client from the repo root (same candidates cli.ts uses).
 * Exported so the control server can serve bundled assets (fonts) too.
 */
export function webClientDir(): string | null {
  const candidates = [
    resolve(import.meta.dir, "../views/web"),
    resolve(import.meta.dir, "../../../apps/web/dist/client"),
    resolve(process.cwd(), "apps/web/dist/client"),
    resolve(process.cwd(), "../../apps/web/dist/client"),
  ];
  for (const dir of candidates) {
    if (existsSync(resolve(dir, "index.html"))) return dir;
  }
  return null;
}

function portBusy(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    const done = (busy: boolean) => {
      socket.destroy();
      resolvePromise(busy);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(500, () => done(false));
  });
}

export function serverState(): { running: boolean; port: number | null } {
  return { running: current !== null, port: current?.port ?? null };
}

/** Start the di server in-process. Concurrent calls share one attempt. */
export async function startServer(): Promise<number> {
  if (current) return current.port;
  starting ??= doStart().finally(() => {
    starting = null;
  });
  return starting;
}

async function doStart(): Promise<number> {
  if (!configPath) throw new Error("config path not set");

  const config = loadConfig(configPath);
  setLogFile(config.files.log_path || null);

  const desired = config.server.port;
  const port = (await portBusy(desired)) ? 0 : desired;
  if (port === 0) {
    appendLog(`[desktop] port ${desired} busy; picking a free port`);
  }

  const db = createDatabase(config.files.db_path);
  await migrate(db);

  const root = webClientDir();
  if (!root) appendLog("[desktop] apps/web/dist/client not found; api only");
  const app = await createApp({
    config,
    db,
    testMode: false,
    webAssets: root ? { root, path: "" } : undefined,
  });

  const server = serveApp(app, port, { config, db });
  const actual = server.port ?? desired;
  current = { server, db, port: actual };
  appendLog(`[desktop] di listening on http://localhost:${actual}`);
  return actual;
}

export async function stopServer(): Promise<void> {
  const running = current;
  if (!running) return;
  current = null;
  running.server.stop(true);
  await running.db.destroy().catch(() => {
    appendLog("[desktop] db close failed");
  });
  appendLog("[desktop] di stopped");
}

export function appUrl(): string | null {
  return current ? `http://localhost:${current.port}` : null;
}
