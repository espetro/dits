import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { defaultFilesDir } from "@di/server/config/load";

/**
 * Seeded first-run config. Based on config.example.yaml with `files.*`
 * omitted — loadConfig defaults those to the platform app-support dir,
 * which is where this file lives too (db/log/data sit next to the config).
 */
const SEED_CONFIG = `# di. desktop config (seeded on first run).
# Point llm/stt/tts at your providers — any OpenAI-compatible endpoint works
# (llm also accepts provider: anthropic for the native /v1/messages wire).
# Env overrides follow DI_<SECTION>__<KEY>, e.g. DI_LLM__API_KEY.
# See config.example.yaml in the repo for the full option set.

server:
  port: 3000
  auth: none

llm:
  provider: openai
  base_url: https://api.openai.com/v1
  # api_key: sk-...
  model: gpt-5-mini

stt:
  base_url: https://api.openai.com/v1
  # api_key: sk-...
  model: whisper-1
  mode: buffered

tts:
  base_url: https://api.openai.com/v1
  # api_key: sk-...
  model: tts-1
  voice: alloy

# optional: enables document ingestion (RAG). omit to disable file uploads.
# embeddings:
#   base_url: https://api.openai.com/v1
#   model: text-embedding-3-small
`;

/** App-support dir: ~/Library/Application Support/di, %APPDATA%/di, ~/.local/share/di. */
export function dataDir(): string {
  return defaultFilesDir();
}

export function ensureDataDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

/** Write the seeded config on first run; returns the config.yaml path. */
export function ensureConfigFile(dir: string): string {
  ensureDataDir(dir);
  const configPath = join(dir, "config.yaml");
  if (!existsSync(configPath)) {
    writeFileSync(configPath, SEED_CONFIG);
  }
  return configPath;
}

/** Ensure the parent dir of a file path exists. */
export function ensureParent(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}
