import { resolve } from "node:path";

const DESKTOP_DIR = resolve(import.meta.dirname, "..");
const REPO_ROOT = resolve(DESKTOP_DIR, "..", "..");
const WEB_DIR = resolve(REPO_ROOT, "apps", "web");

const run = async (cmd: string[], cwd: string): Promise<void> => {
  const proc = Bun.spawn(cmd, {
    cwd,
    env: process.env,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exit = await proc.exited;
  if (exit !== 0) throw new Error(`${cmd.join(" ")} exited with code ${exit}`);
};

console.log("==> building web SPA...");
await run(["bun", "run", "build"], WEB_DIR);

console.log("==> building electrobun app...");
await run(["electrobun", "build", "--env=stable"], DESKTOP_DIR);

console.log("==> done; artifacts in platforms/desktop/artifacts/");
