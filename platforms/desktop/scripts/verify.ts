import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { startControlServer } from "../src/control";
import { setConfigPath, startServer, stopServer } from "../src/server";
import {
  loadFixture,
  startServer as startMockServer,
} from "../../../packages/evals/mock-provider/main.ts";

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

// Relay legs: /v1/relay passthrough against the evals mock provider. The
// seeded config above points providers at dead endpoints on purpose; the
// relay takes its upstream from the query, so this leg brings its own mock
// (in-process, no-cors) when nothing answers on MOCK_PORT (default 9000),
// and reuses an already-running one (e.g. started by verify-relay.sh).
const mockPort = Number(process.env.MOCK_PORT ?? 9000);
const mockBase = `http://localhost:${mockPort}`;
const mockUp = await fetch(`${mockBase}/v1/models`, { signal: AbortSignal.timeout(1000) })
  .then((res) => res.ok)
  .catch(() => false);
let mockServer: ReturnType<typeof startMockServer> | null = null;
if (!mockUp) {
  mockServer = startMockServer(mockPort, undefined, { noCors: true });
  console.log(`[verify] mock provider on :${mockServer.port}`);
}

const relayUrl = (upstream: string) =>
  `http://localhost:${port}/v1/relay?url=${encodeURIComponent(upstream)}`;

const modelsRes = await fetch(relayUrl(`${mockBase}/v1/models`));
const modelsJson = (await modelsRes.json()) as { data?: { id?: string }[] };
const expectedModels = [...loadFixture().models].sort();
const relayedModels = (modelsJson.data ?? []).map((m) => m.id ?? "").sort();
failures += ok(
  "relay GET /v1/models matches mock fixture",
  modelsRes.status === 200 &&
    relayedModels.length > 0 &&
    relayedModels.join() === expectedModels.join(),
)
  ? 0
  : 1;

const chatRes = await fetch(relayUrl(`${mockBase}/v1/chat/completions`), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    model: "mock-llm",
    messages: [{ role: "user", content: "hi" }],
    stream: true,
  }),
});
const chatReader = chatRes.body?.getReader();
const firstChunk = chatReader ? (await chatReader.read()).value : undefined;
await chatReader?.cancel();
failures += ok(
  "relay POST /v1/chat/completions streams first chunk",
  chatRes.status === 200 && firstChunk !== undefined && firstChunk.length > 0,
)
  ? 0
  : 1;

const ssrfRes = await fetch(relayUrl("file:///etc/passwd"));
failures += ok("relay rejects file:// url with 400", ssrfRes.status === 400) ? 0 : 1;
// No authorization-forwarding leg: the mock provider does not echo request
// headers; that behavior is covered by apps/server routes.test.ts instead.

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

mockServer?.stop(true);

console.log(failures === 0 ? "[verify] PASS" : `[verify] ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
