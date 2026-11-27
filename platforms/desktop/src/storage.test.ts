import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "@di/server/config/load";

import { ensureConfigFile } from "./storage";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("ensureConfigFile", () => {
  it("seeds builtin stt/tts and a config that loads", () => {
    const dir = mkdtempSync(join(tmpdir(), "di-seed-"));
    dirs.push(dir);
    const config = loadConfig(ensureConfigFile(dir));
    expect(config.stt?.provider).toBe("builtin");
    expect(config.tts?.provider).toBe("builtin");
    expect(config.stt?.base_url).toBeUndefined();
    expect(config.tts?.base_url).toBeUndefined();
    expect(config.files.db_path).toBe(join(dir, "di.db"));
    expect(config.files.log_path).toBe(join(dir, "di.log"));
    expect(config.files.data_dir).toBe(join(dir, "data"));
  });

  it("does not overwrite an existing config", () => {
    const dir = mkdtempSync(join(tmpdir(), "di-seed-"));
    dirs.push(dir);
    const path = join(dir, "config.yaml");
    writeFileSync(path, "server:\n  port: 3999\n");
    expect(ensureConfigFile(dir)).toBe(path);
    expect(readFileSync(path, "utf8")).toBe("server:\n  port: 3999\n");
  });
});
