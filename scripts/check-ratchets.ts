#!/usr/bin/env bun
/**
 * Fails only when a tracked metric got worse than .ratchets.json. Never
 * fails on an improvement, and never silently locks in new debt — a commit
 * that raises a baseline must edit .ratchets.json in the same diff.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const ratchets = JSON.parse(readFileSync(join(root, ".ratchets.json"), "utf8"));

async function countTscErrors(): Promise<number> {
  let total = 0;
  for (const ws of ["packages/shared", "apps/server", "apps/web", "packages/evals"]) {
    const proc = Bun.spawn(["bunx", "tsc", "--noEmit", "--incremental", "false"], {
      cwd: join(root, ws),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    await proc.exited;
    total += ((out + err).match(/error TS/g) ?? []).length;
  }
  return total;
}

async function countOxlintErrors(): Promise<number> {
  const proc = Bun.spawn(
    [
      "bunx",
      "oxlint",
      "apps/web/src",
      "packages/shared/src",
      "apps/server/src",
      "packages/evals/src",
    ],
    {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  return ((out + err).match(/: error /g) ?? []).length;
}

async function countCycles(): Promise<number> {
  const proc = Bun.spawn(["bunx", "rev-dep", "circular", "apps/web/src/router.tsx"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  const m = out.match(/Found (\d+) circular/);
  return m ? Number(m[1]) : 0;
}

function maxFileLoc(): number {
  let max = 0;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if ([".ts", ".tsx"].includes(extname(full)) && !full.endsWith(".gen.ts")) {
        const loc = readFileSync(full, "utf8").split("\n").length;
        if (loc > max) max = loc;
      }
    }
  };
  for (const ws of [
    "packages/shared/src",
    "apps/server/src",
    "apps/web/src",
    "packages/evals/src",
  ]) {
    const dir = join(root, ws);
    try {
      walk(dir);
    } catch {
      // workspace src dir absent; skip
    }
  }
  return max;
}

const measured = {
  tscErrors: await countTscErrors(),
  oxlintErrors: await countOxlintErrors(),
  cycles: await countCycles(),
  maxFileLoc: maxFileLoc(),
};

let regressed = false;
for (const [key, baseline] of Object.entries(ratchets)) {
  if (key === "_comment") continue;
  const value = measured[key as keyof typeof measured];
  if (typeof value === "number" && typeof baseline === "number" && value > baseline) {
    console.error(`ratchet regression: ${key} = ${value} (baseline ${baseline})`);
    regressed = true;
  }
}

if (regressed) {
  console.error("Update .ratchets.json in this commit if the increase is intentional.");
  process.exit(1);
}
console.log(`OK: ${JSON.stringify(measured)}`);
