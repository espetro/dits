import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, loadConfig } from "./load";

const minimal = `
server:
  port: 8080
llm:
  provider: mock
  base_url: http://localhost:9000/v1
  model: mock-chat
stt:
  base_url: http://localhost:9000/v1
  model: mock-stt
  mode: buffered
tts:
  base_url: http://localhost:9000/v1
  model: mock-tts
  voice: alloy
files:
  db_path: data/di.db
  log_path: data/di.log
  data_dir: data
`;

function writeConfig(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "di-config-"));
  const p = join(dir, "config.yaml");
  writeFileSync(p, body);
  return p;
}

describe("loadConfig", () => {
  it("accepts a valid config", () => {
    const cfg = loadConfig(writeConfig(minimal));
    expect(cfg.server.port).toBe(8080);
  });

  it("fails fast naming the exact bad key", () => {
    const bad = minimal.replace("port: 8080", "port: 'oops'");
    try {
      loadConfig(writeConfig(bad));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as Error).message).toContain("server.port");
    }
  });

  it("applies DI_ env overrides with double-underscore nesting", () => {
    process.env.DI_LLM__PROVIDER = "openai";
    try {
      const cfg = loadConfig(writeConfig(minimal));
      expect(cfg.llm.provider).toBe("openai");
    } finally {
      delete process.env.DI_LLM__PROVIDER;
    }
  });

  it("rejects a missing file", () => {
    expect(() => loadConfig("/nonexistent/config.yaml")).toThrow(ConfigError);
  });
});
