import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

import { loadConfig } from "@di/server/config/load";

import { startControlServer } from "../src/control";
import { createServerSupervisor, webClientDir, type ServerSupervisor } from "../src/server";
import { ensureConfigFile } from "../src/storage";

/**
 * Headless desktop supervisor verification. This intentionally exercises only
 * desktop-owned behavior: first-run seeding, sidecar lifecycle, port fallback,
 * SPA wiring, control state, reset and log visibility. Provider behavior,
 * relay hardening and the server-hosted UI golden path belong to the server
 * and e2e suites.
 */

const ok = (name: string, cond: boolean): number => {
  console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  return cond ? 0 : 1;
};

const get = (url: string) => fetch(url, { signal: AbortSignal.timeout(3000) });
const post = (url: string) => fetch(url, { method: "POST", signal: AbortSignal.timeout(3000) });

const firstAsset = (root: string): string | null => {
  const walk = (dir: string): string | null => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = walk(full);
        if (found) return found;
      } else if (/\.(css|js|svg|png|woff2)$/.test(entry.name)) {
        return full;
      }
    }
    return null;
  };
  return walk(root);
};

interface StateResponse {
  running?: boolean;
  port?: number | null;
  url?: string | null;
  configPath?: string | null;
  logPath?: string | null;
  logs?: string[];
}

const stateAt = async (controlPort: number): Promise<StateResponse> =>
  (await (await get(`http://localhost:${controlPort}/api/state`)).json()) as StateResponse;

const verify = async (): Promise<number> => {
  let failures = 0;
  const supportDir = mkdtempSync(join(tmpdir(), "di-desktop-verify-"));
  let blocker: ReturnType<typeof Bun.serve> | null = null;
  let control: { port: number; stop: () => void } | null = null;
  let supervisor: ServerSupervisor | null = null;

  try {
    console.log(`[verify] fresh app-support dir: ${supportDir}`);
    const configPath = ensureConfigFile(supportDir);
    failures += ok("first-run config seeded", existsSync(configPath));
    const seededRaw = readFileSync(configPath, "utf8");
    const seeded = loadConfig(configPath);
    failures += ok(
      "seeded config uses builtin voice without a mock provider",
      seeded.stt?.provider === "builtin" &&
        seeded.tts?.provider === "builtin" &&
        !seededRaw.includes("provider: mock"),
    );
    failures += ok(
      "seeded files stay inside the fresh app-support dir",
      seeded.files.db_path === join(supportDir, "di.db") &&
        seeded.files.log_path === join(supportDir, "di.log") &&
        seeded.files.data_dir === join(supportDir, "data"),
    );

    const spaRoot = webClientDir();
    failures += ok("desktop discovers a built SPA root", spaRoot !== null);
    if (!spaRoot) {
      console.error("[verify] missing apps/web/dist/client; run `mise run build` first");
      return failures + 1;
    }

    const desiredPort = 37337;
    writeFileSync(
      configPath,
      `server:
  port: ${desiredPort}
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
  db_path: ${seeded.files.db_path}
  log_path: ${seeded.files.log_path}
  data_dir: ${seeded.files.data_dir}
`,
    );

    try {
      blocker = Bun.serve({
        port: desiredPort,
        hostname: "127.0.0.1",
        fetch: () => new Response("occupied"),
      });
    } catch {
      console.log(`[verify] port ${desiredPort} was already occupied`);
    }

    // Keep verification deterministic and offline: model warming is product
    // behavior, but downloading multi-megabyte voice models is not needed to
    // prove supervisor lifecycle. The injected seam is desktop-local.
    supervisor = createServerSupervisor({ warmBuiltinModels: () => {} });
    supervisor.setConfigPath(configPath);
    const port = await supervisor.startServer();
    console.log(`[verify] di on :${port}`);
    failures += ok(
      "occupied configured port falls back to a free port",
      port !== desiredPort && port > 0,
    );

    const health = await get(`http://localhost:${port}/api/health`);
    const healthJson = (await health.json()) as { ok?: boolean; testMode?: boolean };
    failures += ok(
      "GET /api/health answers in production mode",
      health.ok && healthJson.ok === true && healthJson.testMode === false,
    );

    const index = await get(`http://localhost:${port}/`);
    const indexHtml = await index.text();
    failures += ok(
      "GET / serves the discovered SPA index",
      index.ok && indexHtml === readFileSync(join(spaRoot, "index.html"), "utf8"),
    );

    const asset = firstAsset(spaRoot);
    if (!asset) {
      failures += ok("SPA bundle exposes a static asset", false);
    } else {
      const assetPath = relative(spaRoot, asset).split(sep).map(encodeURIComponent).join("/");
      const assetRes = await get(`http://localhost:${port}/${assetPath}`);
      failures += ok(
        "static SPA asset is served",
        assetRes.ok && (await assetRes.arrayBuffer()).byteLength > 0,
      );
    }

    control = startControlServer({
      openExternal: (url) => console.log(`[verify] openExternal ${url}`),
      supervisor,
    });
    const dash = await get(`http://localhost:${control.port}/`);
    const dashHtml = await dash.text();
    failures += ok("control dashboard html", dash.ok && dashHtml.includes("di."));

    const running = await stateAt(control.port);
    failures += ok(
      "control state reports the running sidecar",
      running.running === true &&
        running.port === port &&
        running.url === `http://localhost:${port}`,
    );
    failures += ok(
      "control state exposes config and log paths",
      running.configPath === configPath && running.logPath === seeded.files.log_path,
    );
    failures += ok(
      "control state exposes supervisor logs",
      (running.logs ?? []).some((line) => line.includes("picking a free port")) &&
        (running.logs ?? []).some((line) => line.includes("di listening")),
    );

    const stoppedRes = await post(`http://localhost:${control.port}/api/stop`);
    const stopped = (await stoppedRes.json()) as StateResponse;
    failures += ok("control stop flips state", stoppedRes.ok && stopped.running === false);
    const afterStop = await get(`http://localhost:${port}/api/health`).then(
      (res) => res.ok,
      () => false,
    );
    failures += ok("stopped sidecar no longer answers health", !afterStop);

    const restartedRes = await post(`http://localhost:${control.port}/api/start`);
    const restarted = (await restartedRes.json()) as StateResponse;
    failures += ok(
      "control restart starts the sidecar again",
      restartedRes.ok && restarted.running === true && typeof restarted.port === "number",
    );
    const restartPort = restarted.port ?? 0;
    const restartHealth = await get(`http://localhost:${restartPort}/api/health`);
    failures += ok("restarted sidecar answers health", restartHealth.ok);

    const resetRes = await post(`http://localhost:${control.port}/api/reset`);
    const reset = (await resetRes.json()) as StateResponse;
    failures += ok(
      "factory reset reseeds and restarts a running sidecar",
      resetRes.ok && reset.running === true,
    );
    const resetConfig = readFileSync(configPath, "utf8");
    failures += ok(
      "factory reset restores the seeded config",
      resetConfig.includes("seeded on first run") &&
        resetConfig.includes("provider: builtin") &&
        !resetConfig.includes("mock-llm"),
    );
    const resetPort = reset.port ?? 0;
    if (resetPort > 0) {
      const resetHealth = await get(`http://localhost:${resetPort}/api/health`);
      const resetSpa = await get(`http://localhost:${resetPort}/`);
      failures += ok("post-reset sidecar serves health and SPA", resetHealth.ok && resetSpa.ok);
    } else {
      failures += ok("post-reset sidecar exposes a port", false);
    }
    failures += ok("reset recreates a visible log file", existsSync(join(supportDir, "di.log")));

    const finalStop = await post(`http://localhost:${control.port}/api/stop`);
    const finalState = (await finalStop.json()) as StateResponse;
    failures += ok(
      "final stop leaves control state stopped",
      finalStop.ok && finalState.running === false,
    );
  } finally {
    control?.stop();
    await supervisor?.stopServer().catch(() => {});
    blocker?.stop(true);
    rmSync(supportDir, { recursive: true, force: true });
  }

  return failures;
};

const failures = await verify();
console.log(failures === 0 ? "[verify] PASS" : `[verify] ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
