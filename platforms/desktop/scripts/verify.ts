import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { startControlServer } from "../src/control";
import { setConfigPath, startServer, stopServer } from "../src/server";

/**
 * Smoke test for the desktop sidecar without the native runtime: seeds a
 * config under build/verify/, starts the server + control API in-process
 * (the same calls src/index.ts makes), then probes them over HTTP.
 * `electrobun build` covers the native packaging half.
 */

const VERIFY_DIR = resolve(import.meta.dirname, "..", "build", "verify");
mkdirSync(VERIFY_DIR, { recursive: true });

const configPath = join(VERIFY_DIR, "config.yaml");
writeFileSync(
  configPath,
  `server:
  port: 37337
llm:
  provider: mock
  base_url: http://localhost:9/v1
  model: mock-llm
stt:
  base_url: http://localhost:9/v1
  model: mock-stt
  mode: buffered
tts:
  base_url: http://localhost:9/v1
  model: mock-tts
  voice: alloy
files:
  db_path: ${VERIFY_DIR}/di.db
  log_path: ${VERIFY_DIR}/di.log
  data_dir: ${VERIFY_DIR}/data
`,
);

const ok = (name: string, cond: boolean) => {
  console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  return cond;
};

let failures = 0;

setConfigPath(configPath);
const port = await startServer();
console.log(`[verify] di on :${port}`);

const health = await fetch(`http://localhost:${port}/api/health`);
const healthJson = (await health.json()) as { ok?: boolean };
failures += ok("GET /api/health", health.ok && healthJson.ok === true) ? 0 : 1;

const index = await fetch(`http://localhost:${port}/`);
const indexHtml = await index.text();
failures += ok("GET / serves SPA index.html", index.ok && indexHtml.includes("<")) ? 0 : 1;

const { port: controlPort } = startControlServer({
  openExternal: (url) => console.log(`[verify] openExternal ${url}`),
});
const dash = await fetch(`http://localhost:${controlPort}/`);
const dashHtml = await dash.text();
failures += ok("control dashboard html", dash.ok && dashHtml.includes("di.")) ? 0 : 1;

const state = (await (await fetch(`http://localhost:${controlPort}/api/state`)).json()) as {
  running?: boolean;
  port?: number;
};
failures += ok("control /api/state running", state.running === true && state.port === port) ? 0 : 1;

await stopServer();
const stopped = (await (await fetch(`http://localhost:${controlPort}/api/state`)).json()) as {
  running?: boolean;
};
failures += ok("stop flips state", stopped.running === false) ? 0 : 1;

console.log(failures === 0 ? "[verify] PASS" : `[verify] ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
