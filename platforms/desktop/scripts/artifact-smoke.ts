import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

/**
 * Packaged desktop smoke, using the unpacked Electrobun bundle as the closest
 * headless equivalent of the real artifact. It statically proves the bundle
 * contains the SPA, vendor voice payload and bun server entrypoint, then runs
 * that bundled entrypoint with DI_DESKTOP_HEADLESS_SMOKE=1 and probes health,
 * SPA serving and control state over loopback.
 *
 * The native launcher/webview half is deliberately manual: a headless pass
 * here never claims OS windowing, signing or notarization coverage.
 */

const DESKTOP_DIR = resolve(import.meta.dirname, "..");

const ok = (name: string, cond: boolean): number => {
  console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  return cond ? 0 : 1;
};

const get = (url: string) => fetch(url, { signal: AbortSignal.timeout(3000) });
const post = (url: string) => fetch(url, { method: "POST", signal: AbortSignal.timeout(3000) });

const walkFiles = (root: string, maxDepth = 8): string[] => {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".git")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else out.push(full);
    }
  };
  walk(root, 0);
  return out;
};

const directEntrypoints = (root: string): string[] =>
  [
    join(root, "Contents", "Resources", "app", "bun", "index.js"),
    join(root, "Resources", "app", "bun", "index.js"),
    join(root, "resources", "app", "bun", "index.js"),
    join(root, "app", "bun", "index.js"),
  ].filter(existsSync);

const findEntrypoint = (input: string): string | null => {
  const root = resolve(input);
  if (!existsSync(root)) return null;
  const direct = directEntrypoints(root);
  if (direct.length > 0) return direct[0]!;
  const files = walkFiles(root);
  return (
    files.find((file) => basename(file) === "index.js" && basename(dirname(file)) === "bun") ?? null
  );
};

const compressedArtifacts = (root: string): string[] => {
  if (!existsSync(root)) return [];
  return walkFiles(root, 3).filter((file) => /\.(dmg|zip|tar\.gz|tar\.zst)$/.test(file));
};

interface ReadyLine {
  controlPort?: number;
  serverPort?: number | null;
  configPath?: string;
}

const waitForReady = async (
  stream: ReadableStream<Uint8Array>,
  timeoutMs: number,
): Promise<{ ready: ReadyLine; output: string }> => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  return await new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      rejectPromise(new Error(`timed out waiting for desktop smoke readiness; output:\n${output}`));
    }, timeoutMs);

    const readNext = () => {
      reader.read().then(({ done, value }) => {
        if (done) {
          clearTimeout(timeout);
          rejectPromise(new Error(`bundled desktop exited before readiness; output:\n${output}`));
          return;
        }
        output += decoder.decode(value, { stream: true });
        const match = output.match(/\[desktop-smoke\] (\{[^\n]+\})/);
        if (!match) {
          readNext();
          return;
        }
        clearTimeout(timeout);
        void reader.cancel();
        try {
          resolvePromise({ ready: JSON.parse(match[1]!) as ReadyLine, output });
        } catch (error) {
          rejectPromise(error);
        }
      }, rejectPromise);
    };
    readNext();
  });
};

const freePort = async (): Promise<number> => {
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("x") });
  const port = probe.port;
  probe.stop(true);
  if (!port) throw new Error("could not reserve a free port");
  return port;
};

interface SupportPaths {
  dir: string;
  env: Record<string, string>;
}

const supportPaths = (home: string): SupportPaths => {
  const xdg = join(home, ".local", "share");
  const appData = join(home, "AppData", "Roaming");
  const dir =
    process.platform === "darwin"
      ? join(home, "Library", "Application Support", "di")
      : process.platform === "win32"
        ? join(appData, "di")
        : join(xdg, "di");
  return {
    dir,
    env: {
      HOME: home,
      USERPROFILE: home,
      XDG_DATA_HOME: xdg,
      APPDATA: appData,
    },
  };
};

const writeRuntimeConfig = (dir: string, port: number): string => {
  mkdirSync(dir, { recursive: true });
  const configPath = join(dir, "config.yaml");
  const q = (value: string) => JSON.stringify(value);
  writeFileSync(
    configPath,
    `server:
  port: ${port}
llm:
  provider: mock
  base_url: http://127.0.0.1:9/v1
  model: mock-llm
stt:
  base_url: http://127.0.0.1:9/v1
  model: mock-stt
  mode: buffered
tts:
  base_url: http://127.0.0.1:9/v1
  model: mock-tts
  voice: alloy
files:
  db_path: ${q(join(dir, "di.db"))}
  log_path: ${q(join(dir, "di.log"))}
  data_dir: ${q(join(dir, "data"))}
`,
  );
  return configPath;
};

const smokeBundle = async (entrypoint: string): Promise<number> => {
  let failures = 0;
  const bunDir = dirname(entrypoint);
  const appDir = resolve(bunDir, "..");
  const resourcesDir = resolve(appDir, "..");
  const webIndex = join(appDir, "views", "web", "index.html");
  const vendorDir = join(appDir, "vendor", "voice");
  const versionJson = join(resourcesDir, "version.json");

  console.log(`[artifact-smoke] bundle entrypoint: ${entrypoint}`);
  failures += ok("bundle contains bun server entrypoint", existsSync(entrypoint));
  failures += ok("bundle contains SPA index at views/web", existsSync(webIndex));
  failures += ok("bundle contains vendor voice payload", existsSync(vendorDir));
  failures += ok("bundle contains version.json", existsSync(versionJson));

  const bundledJs = readFileSync(entrypoint, "utf8");
  failures += ok(
    "bundled entrypoint contains desktop supervisor and server health path",
    bundledJs.includes("[desktop] config:") && bundledJs.includes("/api/health"),
  );

  if (existsSync(versionJson)) {
    const version = JSON.parse(readFileSync(versionJson, "utf8")) as { version?: string };
    failures += ok(
      "version.json carries a non-empty stamped version",
      typeof version.version === "string" && version.version.length > 0,
    );
  }

  const home = mkdtempSync(join(tmpdir(), "di-artifact-smoke-home-"));
  const support = supportPaths(home);
  const serverPort = await freePort();
  const configPath = writeRuntimeConfig(support.dir, serverPort);
  let proc: ReturnType<typeof Bun.spawn> | null = null;

  try {
    proc = Bun.spawn([process.execPath, entrypoint], {
      cwd: dirname(entrypoint),
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        ...support.env,
        DI_DESKTOP_HEADLESS_SMOKE: "1",
      },
    });

    const stderrPromise = new Response(proc.stderr).text();
    const [drain, probe] = proc.stdout.tee();
    void new Response(drain).text();
    const { ready, output } = await waitForReady(probe, 10_000);
    failures += ok(
      "bundled entrypoint starts control and sidecar servers",
      typeof ready.controlPort === "number" && typeof ready.serverPort === "number",
    );
    failures += ok(
      "bundled entrypoint uses the preseeded support config",
      ready.configPath === configPath,
    );
    if (typeof ready.controlPort !== "number" || typeof ready.serverPort !== "number") {
      console.log(output);
      console.error(await stderrPromise);
      return failures + 1;
    }

    const base = `http://localhost:${ready.serverPort}`;
    const health = await get(`${base}/api/health`);
    const healthJson = (await health.json()) as { ok?: boolean; testMode?: boolean };
    failures += ok(
      "packaged sidecar answers health in production mode",
      health.ok && healthJson.ok === true && healthJson.testMode === false,
    );

    const spa = await get(`${base}/`);
    const spaHtml = await spa.text();
    failures += ok(
      "packaged sidecar serves bundled SPA index",
      spa.ok && spaHtml === readFileSync(webIndex, "utf8"),
    );

    const stateRes = await get(`http://localhost:${ready.controlPort}/api/state`);
    const state = (await stateRes.json()) as {
      running?: boolean;
      port?: number;
      configPath?: string;
      logPath?: string;
      logs?: string[];
    };
    failures += ok(
      "packaged control state is truthful",
      stateRes.ok &&
        state.running === true &&
        state.port === ready.serverPort &&
        state.configPath === configPath &&
        state.logPath === join(support.dir, "di.log"),
    );
    failures += ok(
      "packaged control state exposes supervisor logs",
      (state.logs ?? []).some((line) => line.includes("di listening")),
    );

    const stopRes = await post(`http://localhost:${ready.controlPort}/api/stop`);
    const stopped = (await stopRes.json()) as { running?: boolean };
    failures += ok("packaged control stop flips state", stopRes.ok && stopped.running === false);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    failures += 1;
  } finally {
    proc?.kill();
    rmSync(home, { recursive: true, force: true });
  }

  return failures;
};

const argValue = (flag: string): string | undefined => {
  const index = Bun.argv.indexOf(flag);
  return index >= 0 ? Bun.argv[index + 1] : undefined;
};

const positional = Bun.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const explicitInput = argValue("--bundle") ?? positional[0] ?? process.env.DI_DESKTOP_BUNDLE;

let entrypoint: string | null = null;
if (explicitInput) {
  entrypoint = findEntrypoint(explicitInput);
  if (!entrypoint) {
    console.error(`[artifact-smoke] FAIL: no unpacked bun entrypoint under ${explicitInput}`);
    process.exit(1);
  }
} else {
  for (const root of [join(DESKTOP_DIR, "build"), join(DESKTOP_DIR, "artifacts")]) {
    if (!existsSync(root)) continue;
    entrypoint = findEntrypoint(root);
    if (entrypoint) break;
  }
  if (!entrypoint) {
    const compressed = compressedArtifacts(join(DESKTOP_DIR, "artifacts"));
    if (compressed.length > 0) {
      console.log(
        `[artifact-smoke] compressed artifacts present but not launched: ${compressed.join(", ")}`,
      );
    }
    console.log(
      "[artifact-smoke] SKIP manual: no unpacked Electrobun bundle found; run `bun run build:desktop` first or pass --bundle <path>",
    );
    console.log(
      "[artifact-smoke] SKIP manual: native launcher, webview, signing and notarization must be checked on a desktop host",
    );
    process.exit(0);
  }
}

const failures = await smokeBundle(entrypoint);
console.log(
  "[artifact-smoke] SKIP manual: native launcher, webview, signing and notarization are not exercised by the headless smoke",
);
console.log(failures === 0 ? "[artifact-smoke] PASS" : `[artifact-smoke] ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
