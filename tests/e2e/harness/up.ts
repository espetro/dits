// Self-contained e2e stack: built SPA served by a test-mode di server on
// :3100, plus mock providers (cors on :3101, no-cors :3102, failure
// injection :3103), then runs playwright with the given args and tears
// everything down. Fixed high ports keep seeded state and specs stable and
// clear of a hand-started dev stack on :3000/:9000.
//
//   bun harness/up.ts [playwright args...]
//   bun harness/up.ts provider-relay.spec.ts -g "401"
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("../../../", import.meta.url).pathname;
const e2eDir = new URL("../", import.meta.url).pathname;

export const PORTS = { server: 3100, cors: 3101, noCors: 3102, fail: 3103 } as const;

const MOCK = `${root}packages/evals/mock-provider/main.ts`;
const SERVER = `${root}apps/server/src/cli.ts`;

const children: ChildProcess[] = [];

function start(cmd: string[], env: Record<string, string> = {}): ChildProcess {
  const child = spawn(cmd[0]!, cmd.slice(1), {
    stdio: "ignore",
    detached: true,
    env: { ...process.env, ...env },
  });
  children.push(child);
  return child;
}

async function waitFor(url: string, label: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${label} never became ready at ${url}`);
}

function stopAll(): void {
  for (const c of children) {
    if (!c.pid) continue;
    try {
      // detached + negative pid kills the whole process group
      process.kill(-c.pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
}

async function main(): Promise<number> {
  if (!existsSync(`${root}apps/web/dist/client`)) {
    console.error("apps/web/dist/client missing: run `mise run build` first");
    return 2;
  }
  for (const port of Object.values(PORTS)) {
    try {
      await fetch(`http://localhost:${port}/`);
      console.error(`port :${port} is already in use; stop the stray process first`);
      return 2;
    } catch {
      // free
    }
  }

  const dir = mkdtempSync(join(tmpdir(), "di-e2e-"));
  const cleanup = () => {
    stopAll();
    rmSync(dir, { recursive: true, force: true });
  };
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });

  try {
    // stt/tts go remote to the cors mock so no wasm model bundle downloads
    const mock = `http://localhost:${PORTS.cors}/v1`;
    writeFileSync(
      join(dir, "config.yaml"),
      `server:
  port: ${PORTS.server}
  auth: none
llm:
  provider: mock
  base_url: ${mock}
  model: mock-llm
stt:
  provider: remote
  base_url: ${mock}
  model: mock-stt
  mode: buffered
tts:
  provider: remote
  base_url: ${mock}
  model: mock-tts
  voice: alloy
embeddings:
  base_url: ${mock}
  model: mock-embed
files:
  db_path: ${dir}/di.db
  log_path: ${dir}/di.log
  data_dir: ${dir}/data
`,
    );

    start(["bun", "run", MOCK, "--port", String(PORTS.cors)]);
    start(["bun", "run", MOCK, "--port", String(PORTS.noCors), "--no-cors"]);
    start(["bun", "run", MOCK, "--port", String(PORTS.fail), "--no-cors"]);
    await Promise.all(
      [PORTS.cors, PORTS.noCors, PORTS.fail].map((p) =>
        waitFor(`http://localhost:${p}/health`, `mock :${p}`),
      ),
    );
    start(["bun", "run", SERVER, "--config", join(dir, "config.yaml")], {
      DI_TEST_MODE: "1",
    });
    await waitFor(`http://localhost:${PORTS.server}/api/health`, "di server");

    const pw = spawn("bun", ["x", "playwright", "test", ...process.argv.slice(2)], {
      cwd: e2eDir,
      stdio: "inherit",
      env: {
        ...process.env,
        DI_URL: `http://localhost:${PORTS.server}`,
        DI_WEB_URL: `http://localhost:${PORTS.server}`,
        MOCK_CORS_PORT: String(PORTS.cors),
        MOCK_NOCORS_PORT: String(PORTS.noCors),
        MOCK_FAIL_PORT: String(PORTS.fail),
      },
    });
    return await new Promise<number>((resolve) => pw.on("exit", (code) => resolve(code ?? 1)));
  } finally {
    cleanup();
  }
}

process.exit(await main());
