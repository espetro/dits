import { rm } from "node:fs/promises";
import { dirname, relative, isAbsolute } from "node:path";

import { loadConfig } from "@di/server/config/load";

import { appendLog } from "./logbuffer";
import { ensureConfigFile } from "./storage";
import { getConfigPath, serverState, startServer, stopServer } from "./server";

export interface ResetPaths {
  dbPath: string;
  dataDir: string;
  logPath: string;
  configPath: string;
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Remove the sqlite db (+ wal/shm sidecars), model/data dir, log and config.
 * Missing paths are fine; anything outside `root` (a user-relocated
 * files.* path) is never touched.
 */
export async function removeDataFiles(root: string, paths: ResetPaths): Promise<void> {
  const targets = [
    paths.dbPath,
    `${paths.dbPath}-wal`,
    `${paths.dbPath}-shm`,
    paths.dataDir,
    paths.logPath,
    paths.configPath,
  ].filter((p) => p !== "" && isInside(root, p));
  await Promise.all(targets.map((p) => rm(p, { recursive: true, force: true })));
}

/**
 * Factory reset: stop the sidecar, delete every file it owns (db, model
 * cache, log, config.yaml with its keys), re-seed the config and restart if
 * it was running. Destructive: only wired to a user-triggered control route.
 */
export async function resetDesktopData(): Promise<void> {
  const configPath = getConfigPath();
  if (!configPath) throw new Error("config path not set");
  const { files } = loadConfig(configPath);
  const wasRunning = serverState().running;
  await stopServer();
  const root = dirname(configPath);
  await removeDataFiles(root, {
    dbPath: files.db_path,
    dataDir: files.data_dir,
    logPath: files.log_path,
    configPath,
  });
  appendLog("[desktop] data reset: db, models, log and config removed");
  // re-seed the default config so the next start has something to load
  ensureConfigFile(root);
  if (wasRunning) await startServer();
}
