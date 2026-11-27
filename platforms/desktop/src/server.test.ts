import { describe, expect, it } from "bun:test";

import type { loadConfig } from "@di/server/config/load";

import { createServerSupervisor, type ServerSupervisorDeps } from "./server";

type DesktopConfig = ReturnType<typeof loadConfig>;

interface HarnessOptions {
  busy?: boolean;
  actualPort?: number;
}

const config = {
  server: { port: 3000, auth: "none" },
  llm: {
    provider: "mock",
    base_url: "http://localhost:9/v1",
    model: "mock-llm",
  },
  stt: { base_url: "http://localhost:9/v1", model: "mock-stt", mode: "buffered" },
  tts: { base_url: "http://localhost:9/v1", model: "mock-tts", voice: "alloy" },
  files: {
    db_path: "/tmp/di-test.db",
    log_path: "/tmp/di-test.log",
    data_dir: "/tmp/di-test-data",
  },
} as DesktopConfig;

function harness(options: HarnessOptions = {}) {
  const events: string[] = [];
  const captures: { servePort?: number; webRoot?: string } = {};
  const db = {
    destroy: async () => {
      events.push("db-destroy");
    },
  };
  const server = {
    port: options.actualPort ?? 3000,
    stop: () => {
      events.push("server-stop");
    },
  };

  const deps: Partial<ServerSupervisorDeps> = {
    loadConfig: () => config,
    createDatabase: (() => {
      events.push("db-create");
      return db;
    }) as unknown as ServerSupervisorDeps["createDatabase"],
    migrate: (async () => {
      events.push("migrate");
    }) as ServerSupervisorDeps["migrate"],
    createApp: (async (appDeps) => {
      captures.webRoot = appDeps.webAssets?.root;
      return {};
    }) as unknown as ServerSupervisorDeps["createApp"],
    serveApp: ((_app, port) => {
      events.push("serve");
      captures.servePort = port;
      return server;
    }) as unknown as ServerSupervisorDeps["serveApp"],
    warmBuiltinModels: () => {
      events.push("warm");
    },
    portBusy: async () => options.busy === true,
    webClientDir: () => "/fixture/web",
    appendLog: (line) => {
      events.push(line);
    },
    setLogFile: (path) => {
      events.push(`log:${path ?? "off"}`);
    },
  };

  return {
    events,
    captures,
    supervisor: createServerSupervisor(deps),
  };
}

describe("desktop server supervisor", () => {
  it("uses the configured port when it is free and passes the discovered SPA root", async () => {
    const t = harness();
    t.supervisor.setConfigPath("/tmp/config.yaml");
    await expect(t.supervisor.startServer()).resolves.toBe(3000);
    expect(t.captures.servePort).toBe(3000);
    expect(t.captures.webRoot).toBe("/fixture/web");
    expect(t.supervisor.serverState()).toEqual({ running: true, port: 3000 });
  });

  it("falls back to an ephemeral port when the configured port is occupied", async () => {
    const t = harness({ busy: true, actualPort: 4567 });
    t.supervisor.setConfigPath("/tmp/config.yaml");
    await expect(t.supervisor.startServer()).resolves.toBe(4567);
    expect(t.captures.servePort).toBe(0);
    expect(t.events).toContain("[desktop] port 3000 busy; picking a free port");
    expect(t.supervisor.appUrl()).toBe("http://localhost:4567");
  });

  it("shares one start attempt between concurrent callers", async () => {
    const t = harness();
    t.supervisor.setConfigPath("/tmp/config.yaml");
    const [a, b] = await Promise.all([t.supervisor.startServer(), t.supervisor.startServer()]);
    expect(a).toBe(3000);
    expect(b).toBe(3000);
    expect(t.events.filter((event) => event === "serve")).toHaveLength(1);
  });

  it("stops cleanly and can restart", async () => {
    const t = harness();
    t.supervisor.setConfigPath("/tmp/config.yaml");
    await t.supervisor.startServer();
    await t.supervisor.stopServer();
    expect(t.supervisor.serverState()).toEqual({ running: false, port: null });
    expect(t.events).toContain("server-stop");
    expect(t.events).toContain("db-destroy");

    await expect(t.supervisor.startServer()).resolves.toBe(3000);
    expect(t.events.filter((event) => event === "serve")).toHaveLength(2);
  });

  it("reports the configured log path", () => {
    const t = harness();
    expect(t.supervisor.configuredLogPath()).toBeNull();
    t.supervisor.setConfigPath("/tmp/config.yaml");
    expect(t.supervisor.configuredLogPath()).toBe("/tmp/di-test.log");
  });
});
