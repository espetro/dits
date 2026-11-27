import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
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
  });
});
