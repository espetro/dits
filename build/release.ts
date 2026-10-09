/**
 * Release archive builder. Produces dist/releases/di-<version>-<target>.tar.gz
 * containing:
 *   di                       compiled binary (bun build --compile; di.exe on windows)
 *   apps/web/dist/client/    SPA assets
 *   config.example.yaml      reference config
 *   README.md                archive-specific quickstart
 *
 * Usage: bun run build/release.ts [--target <bun-target>]...
 * Targets default to the full matrix (see TARGETS). Cross-compilation happens
 * on the host via --target; no VMs needed.
 */
import { parseArgs } from "node:util";
import { $ } from "bun";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const OUT = join(ROOT, "dist", "releases");

const TARGETS = [
  "bun-linux-x64",
  "bun-linux-arm64",
  "bun-darwin-arm64",
  "bun-darwin-x64",
  "bun-windows-x64",
] as const;

type Target = (typeof TARGETS)[number];

const TRIPLES: Record<Target, string> = {
  "bun-linux-x64": "linux-x64",
  "bun-linux-arm64": "linux-arm64",
  "bun-darwin-arm64": "darwin-arm64",
  "bun-darwin-x64": "darwin-x64",
  "bun-windows-x64": "windows-x64",
};

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    target: { type: "string", multiple: true },
    version: { type: "string" },
  },
});

const version =
  values.version ??
  process.env.DI_VERSION ??
  (await $`git -C ${ROOT} describe --tags --always --dirty`.quiet().text()).trim();

const targets = (values.target?.length ? values.target : [...TARGETS]) as Target[];
for (const t of targets) {
  if (!TARGETS.includes(t)) {
    console.error(`unknown target: ${t} (valid: ${TARGETS.join(", ")})`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Prerequisites: web SPA (mise run build does it).
// ---------------------------------------------------------------------------
const spaDir = join(ROOT, "apps", "web", "dist", "client");
if (!existsSync(join(spaDir, "index.html"))) {
  console.error("missing build artifacts; run `mise run build` first");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// README generated per archive. The binary is self-contained — no installer.
// ---------------------------------------------------------------------------
const readme = (target: Target) => {
  const bin = target === "bun-windows-x64" ? "di.exe" : "./di";
  return `# di ${version} (${TRIPLES[target]})

Self-contained distribution: compiled \`di\` server binary and web SPA. The
voice pipeline runs in-process over WebSocket; no SFU or worker needed.

## Layout
- \`${bin === "./di" ? "di" : bin}\`                      server binary (also the CLI)
- \`apps/web/dist/client/\`        SPA assets (served by \`di\`)
- \`config.example.yaml\`     reference configuration

## Quickstart
    cp config.example.yaml config.yaml   # then edit for your providers
    ${bin} --check                        # validate the stack
    ${bin}                                # serve

\`di --check\` verifies: config parses, sqlite is writable, web assets are
present, and each provider endpoint responds.

## Notes
- Voice transport is WebSocket (GET /v1/sessions/:id/voice upgrade); only the
  configured STT/TTS/LLM endpoints must be reachable.
`;
};

// ---------------------------------------------------------------------------
// Per-target staging + archive.
// ---------------------------------------------------------------------------
rmSync(OUT, { recursive: true, force: true });

for (const target of targets) {
  const triple = TRIPLES[target];
  const stage = join(OUT, `di-${version}-${triple}`);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });

  const binName = target === "bun-windows-x64" ? "di.exe" : "di";
  console.log(`==> compiling di for ${target}`);
  const binTmp = join(stage, `${binName}.bin`);
  await $`bun build --compile --target ${target} ${join(ROOT, "apps", "server", "src", "cli.ts")} --outfile ${binTmp}`;

  await $`mv ${binTmp} ${join(stage, binName)}`;
  await $`chmod +x ${join(stage, binName)}`;

  console.log(`==> staging web assets`);
  cpSync(spaDir, join(stage, "apps", "web", "dist", "client"), { recursive: true });

  console.log(`==> staging config, README`);
  cpSync(join(ROOT, "config.example.yaml"), join(stage, "config.example.yaml"));
  writeFileSync(join(stage, "README.md"), readme(target));

  const archive = join(OUT, `di-${version}-${triple}.tar.gz`);
  console.log(`==> archiving ${archive}`);
  await $`tar -czf ${archive} -C ${OUT} ${`di-${version}-${triple}`}`;
  rmSync(stage, { recursive: true, force: true });
}

console.log(`\nrelease archives in ${OUT}:`);
for (const target of targets) {
  const p = join(OUT, `di-${version}-${TRIPLES[target]}.tar.gz`);
  const f = Bun.file(p);
  if (await f.exists()) console.log(`  ${p} (${(f.size / 1024 / 1024).toFixed(1)} MB)`);
}
