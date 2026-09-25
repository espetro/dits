#!/usr/bin/env bun
/**
 * dscheck gate: design-token lint over apps/web/src, enforcing DESIGN.md.
 * The CLI lives in tools/dscheck (outside the workspaces) so its
 * typescript-eslint peer resolves to TS6 — the repo pins TS7, which
 * typescript-eslint rejects. .dscheck-baseline.json absorbs known debt;
 * new findings fail.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const root = `${import.meta.dir}/..`;
const cli = `${root}/tools/dscheck/node_modules/dscheck-cli/dist/cli.js`;

if (!existsSync(cli)) {
  const install = spawnSync("bun", ["install", "--frozen-lockfile", "--cwd", "tools/dscheck"], {
    cwd: root,
    stdio: "inherit",
  });
  if (install.status !== 0) process.exit(install.status ?? 1);
}

const res = spawnSync("bun", [cli, "check", "apps/web/src"], {
  cwd: root,
  stdio: "inherit",
});
process.exit(res.status ?? 1);
