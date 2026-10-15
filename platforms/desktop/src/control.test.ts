import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startControlServer } from "./control";
import type { Supervisor } from "./reset";

let root: string;
let outside: string;
let control: { port: number; stop: () => void } | null = null;

const files = () => ({
  db: join(root, "di.db"),
  data: join(root, "data"),
  log: join(root, "di.log"),
  config: join(root, "config.yaml"),
});

function seed(extraFiles: Record<string, string> = {}) {
  const f = files();
  writeFileSync(
    f.config,
    [
      "server:\n  port: 3000\n  auth: none",
      "llm:\n  provider: openai\n  base_url: https://x.test/v1\n  api_key: sk-secret\n  model: m",
      "stt:\n  base_url: https://x.test/v1\n  model: w\n  mode: buffered",
      "tts:\n  base_url: https://x.test/v1\n  model: t\n  voice: alloy",
      `files:\n  db_path: ${f.db}\n  log_path: ${f.log}\n  data_dir: ${f.data}`,
      "",
    ].join("\n"),
  );
  for (const p of [f.db, `${f.db}-wal`, `${f.db}-shm`, f.log]) writeFileSync(p, "x");
  mkdirSync(join(f.data, "models"), { recursive: true });
  writeFileSync(join(f.data, "models", "m.onnx"), "x");
  for (const [p, c] of Object.entries(extraFiles)) writeFileSync(p, c);
}

function fakeSupervisor(running: boolean) {
  const events: string[] = [];
  let up = running;
  const sup: Supervisor = {
    getConfigPath: () => files().config,
    serverState: () => ({ running: up, port: up ? 4321 : null }),
    startServer: async () => {
      events.push("start");
      up = true;
      return 4321;
    },
    stopServer: async () => {
      events.push("stop");
      up = false;
    },
  };
  return { sup, events };
}

const reset = (port: number) => fetch(`http://127.0.0.1:${port}/api/reset`, { method: "POST" });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "di-ctl-"));
  outside = mkdtempSync(join(tmpdir(), "di-ctl-out-"));
});
afterEach(() => {
  control?.stop();
  control = null;
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("POST /api/reset", () => {
  it("wipes files, re-seeds config and restarts only a running server", async () => {
    seed();
    const { sup, events } = fakeSupervisor(true);
    control = startControlServer({ openExternal: () => {}, supervisor: sup });
    const res = await reset(control.port);
    expect(res.status).toBe(200);
    const f = files();
    for (const p of [f.db, `${f.db}-wal`, `${f.db}-shm`, f.data, f.log]) {
      expect(existsSync(p)).toBe(false);
    }
    const seeded = readFileSync(f.config, "utf8");
    expect(seeded).toContain("seeded on first run");
    expect(seeded).not.toContain("sk-secret");
    expect(events).toEqual(["stop", "start"]);
    expect(((await res.json()) as { running: boolean }).running).toBe(true);
  });

  it("does not start a server that was stopped", async () => {
    seed();
    const { sup, events } = fakeSupervisor(false);
    control = startControlServer({ openExternal: () => {}, supervisor: sup });
    expect((await reset(control.port)).status).toBe(200);
    expect(events).toEqual(["stop"]);
    expect(existsSync(files().config)).toBe(true);
    expect(existsSync(files().db)).toBe(false);
  });

  it("never removes relocated paths outside the config dir", async () => {
    seed();
    const keepData = join(outside, "data");
    const keepDb = join(outside, "di.db");
    mkdirSync(keepData);
    writeFileSync(join(keepData, "keep.txt"), "x");
    writeFileSync(keepDb, "x");
    const f = files();
    writeFileSync(
      f.config,
      readFileSync(f.config, "utf8").replace(
        /files:[\s\S]*$/,
        `files:\n  db_path: ${keepDb}\n  log_path: ${f.log}\n  data_dir: ${keepData}\n`,
      ),
    );
    const { sup } = fakeSupervisor(false);
    control = startControlServer({ openExternal: () => {}, supervisor: sup });
    expect((await reset(control.port)).status).toBe(200);
    expect(existsSync(join(keepData, "keep.txt"))).toBe(true);
    expect(existsSync(keepDb)).toBe(true);
    expect(existsSync(f.log)).toBe(false);
    // sibling files in the config dir that the config does not own survive
  });

  it("returns 500 with the error when the config path is unset", async () => {
    const sup: Supervisor = {
      getConfigPath: () => null,
      serverState: () => ({ running: false, port: null }),
      startServer: async () => 0,
      stopServer: async () => {},
    };
    control = startControlServer({ openExternal: () => {}, supervisor: sup });
    const res = await reset(control.port);
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toContain("config path");
  });
});
