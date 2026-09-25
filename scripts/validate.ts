#!/usr/bin/env bun
/**
 * Tiered backpressure gate. Tier boundaries follow cost:
 *   T0 <2s (--staged, default in pre-commit)  — oxfmt/check-*.ts on staged files
 *   T1 ~10s (--quick)                          — T0 over the full tree + oxlint + ast-grep + ratchets
 * oxlint's error count is a ratcheted metric (checked in T1), not a T0 hard
 * gate: the tree carries pre-existing debt, and a per-commit hard-zero
 * would block commits unrelated to that debt. import-paths/oxfmt/agents.md
 * length are zero-baseline correctness checks, so those stay hard gates.
 *   T2 ~1-2min cold, seconds warm (default)     — T1 + turbo typecheck/test, affected only, queued
 *   T3 slow (--full)                            — T2 + full turbo + knip + oxlint --type-aware, queued
 * T2/T3 never run two-at-once: routed through `ts -S 1 -L typecheck` (task-spooler).
 */
import { spawn } from "node:child_process";
import task from "tasuku";

interface Step {
  title: string;
  cmd: string;
  args: string[];
}

const staged = process.argv.includes("--staged");
const quick = process.argv.includes("--quick");
const full = process.argv.includes("--full");

function stagedSourceFiles(): string[] {
  const { stdout } = Bun.spawnSync(["git", "diff", "--cached", "--name-only", "--diff-filter=ACM"]);
  return stdout
    .toString()
    .split("\n")
    .filter((f) => /\.tsx?$/.test(f));
}

// T0 (--staged) only inspects staged files — pre-existing tree-wide debt is
// caught by ratchets at T1/T2, not by every commit regardless of what it touches.
const t0Files = staged ? stagedSourceFiles() : [];
const skipT0 = staged && t0Files.length === 0;

const t0: Step[] = skipT0
  ? []
  : [
      {
        title: "oxfmt --check",
        cmd: "bunx",
        args: ["oxfmt", "--check", ...(staged ? t0Files : ["."])],
      },
      {
        title: "import paths",
        cmd: "bun",
        args: ["scripts/check-import-paths.ts", ...(staged ? t0Files : [])],
      },
      {
        title: "agents.md length",
        cmd: "bun",
        args: ["scripts/check-agents-md-length.ts"],
      },
    ];

const t1: Step[] = [
  { title: "ast-grep scan", cmd: "bunx", args: ["ast-grep", "scan"] },
  { title: "ratchets", cmd: "bun", args: ["scripts/check-ratchets.ts"] },
  { title: "dscheck", cmd: "bun", args: ["scripts/check-dscheck.ts"] },
];

const t2: Step[] = [
  {
    title: "typecheck + test (affected)",
    cmd: "bunx",
    args: ["turbo", "run", "typecheck", "test", "--filter=...[origin/main]", "--concurrency=1"],
  },
];

const t3: Step[] = [
  {
    title: "typecheck + test (all)",
    cmd: "bunx",
    args: ["turbo", "run", "typecheck", "test", "--concurrency=1"],
  },
  {
    title: "knip",
    cmd: "bunx",
    args: ["knip", "--include", "files,dependencies"],
  },
];

let steps: Step[];
let heavy = false;
if (staged) {
  steps = t0;
} else if (quick) {
  steps = [...t0, ...t1];
} else if (full) {
  steps = [...t0, ...t1, ...t2, ...t3];
  heavy = true;
} else {
  steps = [...t0, ...t1, ...t2];
  heavy = true;
}

function run(cmd: string, args: string[]): Promise<{ code: number; output: string }> {
  const { promise, resolve } = Promise.withResolvers<{
    code: number;
    output: string;
  }>();
  const child = spawn(cmd, args, {
    cwd: `${import.meta.dir}/..`,
    shell: false,
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d.toString()));
  child.stderr.on("data", (d) => (output += d.toString()));
  child.on("close", (code) => resolve({ code: code ?? 1, output }));
  return promise;
}

function hasTaskSpooler(): boolean {
  try {
    return Bun.spawnSync(["ts", "-V"]).exitCode === 0;
  } catch {
    return false;
  }
}

async function runHeavy(steps: Step[]): Promise<{ code: number; output: string }[]> {
  // Serialize T2/T3 across concurrent agents/invocations via the task-spooler
  // one-slot queue: `ts -S 1` caps the server at one running job, `ts -f`
  // runs synchronously in this process (enqueues and blocks here, rather
  // than stacking a second tsgo process if another `validate` is mid-run).
  // CI runs a single job with nothing else to stack against, and doesn't
  // have `ts` installed, so it runs the steps directly instead.
  const queued = hasTaskSpooler();
  if (queued) spawn("ts", ["-S", "1"]).unref();
  const results: { code: number; output: string }[] = [];
  for (const step of steps) {
    results.push(
      queued
        ? await run("ts", ["-f", "-L", "typecheck", step.cmd, ...step.args])
        : await run(step.cmd, step.args),
    );
  }
  return results;
}

const cheapSteps = heavy
  ? steps.slice(0, steps.length - (full ? t2.length + t3.length : t2.length))
  : steps;
const heavySteps = heavy ? steps.slice(cheapSteps.length) : [];

const cheapResults = await Promise.all(
  cheapSteps.map((step) =>
    task(step.title, async ({ setError }) => {
      const { code, output } = await run(step.cmd, step.args);
      if (code !== 0) setError(output.trim() || `exited with code ${code}`);
    }),
  ),
);

let failed = cheapResults.some((r) => r.state === "error");
for (let i = 0; i < cheapResults.length; i++) {
  if (cheapResults[i]!.state === "error") {
    console.log(`\n--- ${cheapSteps[i]!.title} output ---`);
    console.log(cheapResults[i]!.error);
  }
}

if (heavySteps.length > 0 && (!failed || process.argv.includes("--always-heavy"))) {
  const heavyResults = await runHeavy(heavySteps);
  for (let i = 0; i < heavyResults.length; i++) {
    const { code, output } = heavyResults[i]!;
    if (code !== 0) {
      failed = true;
      console.log(`\n--- ${heavySteps[i]!.title} output ---`);
      console.log(output.trim());
    } else {
      console.log(`ok: ${heavySteps[i]!.title}`);
    }
  }
}

process.exit(failed ? 1 : 0);
