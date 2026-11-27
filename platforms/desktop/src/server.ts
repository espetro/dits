import { existsSync } from "node:fs";
import { createConnection } from "node:net";
import { resolve } from "node:path";

import { createApp, serveApp } from "@di/server/api/app";
import { loadConfig } from "@di/server/config/load";
import { createDatabase, migrate } from "@di/server/store/db";
import { warmBuiltinModels } from "@di/server/voice/builtin/models";
import type { Db } from "@di/server/store/db";

import { appendLog, setLogFile } from "./logbuffer";

interface RunningServer {
  server: ReturnType<typeof Bun.serve>;
  db: Db;
  port: number;
}

export interface ServerState {
  running: boolean;
  port: number | null;
}

export interface ServerSupervisor {
  setConfigPath: (path: string) => void;
  getConfigPath: () => string | null;
  configuredLogPath: () => string | null;
  serverState: () => ServerState;
  startServer: () => Promise<number>;
  stopServer: () => Promise<void>;
  appUrl: () => string | null;
}

type DesktopConfig = ReturnType<typeof loadConfig>;

export interface ServerSupervisorDeps {
  loadConfig: typeof loadConfig;
  createDatabase: typeof createDatabase;
  migrate: typeof migrate;
  createApp: typeof createApp;
  serveApp: typeof serveApp;
  warmBuiltinModels: (config: DesktopConfig) => void;
  portBusy: (port: number) => Promise<boolean>;
  webClientDir: () => string | null;
  appendLog: (line: string) => void;
  setLogFile: (path: string | null) => void;
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

/**
 * Create the desktop sidecar supervisor. Every effectful edge is injectable:
 * the verifier and unit tests can disable model warming, use a fixture SPA,
 * or occupy ports without changing server security or provider behavior.
 */
export function createServerSupervisor(
  overrides: Partial<ServerSupervisorDeps> = {},
): ServerSupervisor {
  const deps: ServerSupervisorDeps = {
    loadConfig,
    createDatabase,
    migrate,
    createApp,
    serveApp,
    warmBuiltinModels,
    portBusy,
    webClientDir,
    appendLog,
    setLogFile,
    ...overrides,
  };

  let current: RunningServer | null = null;
  let configPath: string | null = null;
  let starting: Promise<number> | null = null;

  const doStart = async (): Promise<number> => {
    if (!configPath) throw new Error("config path not set");

    const config = deps.loadConfig(configPath);
    deps.setLogFile(config.files.log_path || null);

    const desired = config.server.port;
    const port = (await deps.portBusy(desired)) ? 0 : desired;
    if (port === 0) {
      deps.appendLog(`[desktop] port ${desired} busy; picking a free port`);
    }

    const db = deps.createDatabase(config.files.db_path);
    let server: ReturnType<typeof Bun.serve> | null = null;
    try {
      await deps.migrate(db);

      const root = deps.webClientDir();
      if (!root) deps.appendLog("[desktop] apps/web/dist/client not found; api only");
      const app = await deps.createApp({
        config,
        db,
        testMode: false,
        webAssets: root ? { root, path: "" } : undefined,
      });

      server = deps.serveApp(app, port, { config, db });
      // builtin voice engines: pull models in the background (cli.ts does the same)
      deps.warmBuiltinModels(config);
      const actual = server.port ?? desired;
      current = { server, db, port: actual };
      deps.appendLog(`[desktop] di listening on http://localhost:${actual}`);
      return actual;
    } catch (error) {
      server?.stop(true);
      await db.destroy().catch(() => {
        deps.appendLog("[desktop] db close failed");
      });
      throw error;
    }
  };

  const startServer = async (): Promise<number> => {
    if (current) return current.port;
    starting ??= doStart().finally(() => {
      starting = null;
    });
    return starting;
  };

  const stopServer = async (): Promise<void> => {
    const running = current;
    if (!running) return;
    current = null;
    running.server.stop(true);
    await running.db.destroy().catch(() => {
      deps.appendLog("[desktop] db close failed");
    });
    deps.appendLog("[desktop] di stopped");
  };

  return {
    setConfigPath: (path) => {
      configPath = path;
    },
    getConfigPath: () => configPath,
    configuredLogPath: () => {
      if (!configPath) return null;
      try {
        const path = deps.loadConfig(configPath).files.log_path;
        return path || null;
      } catch {
        return null;
      }
    },
    serverState: () => ({ running: current !== null, port: current?.port ?? null }),
    startServer,
    stopServer,
    appUrl: () => (current ? `http://localhost:${current.port}` : null),
  };
}

/** Process-wide supervisor used by the real Electrobun shell. */
export const serverSupervisor = createServerSupervisor();

export function setConfigPath(path: string): void {
  serverSupervisor.setConfigPath(path);
}

export function getConfigPath(): string | null {
  return serverSupervisor.getConfigPath();
}

/**
 * Configured log file path from the current config.yaml, or null when the
 * config is unreadable/invalid or log_path is disabled (""). The dashboard
 * surfaces this so users (and their agents) know where the debug log lands.
 */
export function configuredLogPath(): string | null {
  return serverSupervisor.configuredLogPath();
}

export function serverState(): ServerState {
  return serverSupervisor.serverState();
}

/** Start the di server in-process. Concurrent calls share one attempt. */
export async function startServer(): Promise<number> {
  return serverSupervisor.startServer();
}

export async function stopServer(): Promise<void> {
  return serverSupervisor.stopServer();
}

export function appUrl(): string | null {
  return serverSupervisor.appUrl();
}
