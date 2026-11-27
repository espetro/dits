import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { removeDataFiles } from "./reset";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("removeDataFiles", () => {
  it("removes db sidecars, data dir, log and config inside the root", async () => {
    const root = mkdtempSync(join(tmpdir(), "di-reset-"));
    dirs.push(root);
    const paths = {
      dbPath: join(root, "di.db"),
      dataDir: join(root, "data"),
      logPath: join(root, "di.log"),
      configPath: join(root, "config.yaml"),
    };
    for (const f of [
      paths.dbPath,
      `${paths.dbPath}-wal`,
      `${paths.dbPath}-shm`,
      paths.logPath,
      paths.configPath,
    ])
      writeFileSync(f, "x");
    mkdirSync(join(paths.dataDir, "models"), { recursive: true });
    await removeDataFiles(root, paths);
    for (const p of [
      paths.dbPath,
      `${paths.dbPath}-wal`,
      paths.dataDir,
      paths.logPath,
      paths.configPath,
    ])
      expect(existsSync(p)).toBe(false);
  });

  it("never touches a relocated path outside the root", async () => {
    const root = mkdtempSync(join(tmpdir(), "di-reset-"));
    const outside = mkdtempSync(join(tmpdir(), "di-outside-"));
    dirs.push(root, outside);
    writeFileSync(join(outside, "keep.txt"), "x");
    await removeDataFiles(root, {
      dbPath: join(root, "di.db"),
      dataDir: outside,
      logPath: "",
      configPath: join(root, "config.yaml"),
    });
    expect(existsSync(join(outside, "keep.txt"))).toBe(true);
  });
});
