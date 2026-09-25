/**
 * Release archive builder. Produces dist/releases/di-<version>-<target>.tar.gz
 * containing:
 *   di                       compiled binary (bun build --compile)
 *   apps/web/dist/client/         SPA assets
 *   config.example.yaml      reference config
 *   install.sh               first-run installer (also curl-able standalone)
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

const TARGETS = ["bun-linux-x64", "bun-linux-arm64", "bun-darwin-arm64", "bun-darwin-x64"] as const;

type Target = (typeof TARGETS)[number];

const TRIPLES: Record<Target, string> = {
  "bun-linux-x64": "linux-x64",
  "bun-linux-arm64": "linux-arm64",
  "bun-darwin-arm64": "darwin-arm64",
  "bun-darwin-x64": "darwin-x64",
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
// Installer + README generated per archive.
// ---------------------------------------------------------------------------
const installer = `#!/bin/sh
# di runtime installer. Installs bun (if needed).
set -e

have() { command -v "$1" >/dev/null 2>&1; }

# Runtime: bun (preferred) or node >= 22.
if have bun; then
  echo "[install] bun found: \$(bun --version)"
elif have node; then
  major=\$(node -p 'process.versions.node.split(".")[0]')
  if [ "\$major" -lt 22 ]; then
    echo "[install] node >= 22 required (found \$major); installing bun instead" >&2
    curl -fsSL https://bun.sh/install | bash
  else
    echo "[install] node found: \$(node --version)"
  fi
else
  echo "[install] no runtime found; installing bun" >&2
  curl -fsSL https://bun.sh/install | bash
fi

echo "[install] done. Next: cp config.example.yaml config.yaml, edit it, then run ./di --config config.yaml"
`;

const readme = (target: Target) => `# di ${version} (${TRIPLES[target]})

Self-contained distribution: compiled \`di\` server binary and web SPA. The
voice pipeline runs in-process over WebSocket; no SFU or worker needed.

## Layout
- \`di\`                      server binary (also the CLI)
- \`apps/web/dist/client/\`        SPA assets (served by \`di\`)
- \`config.example.yaml\`     reference configuration
- \`install.sh\`              runtime installer (bun/node check)

## Quickstart
    ./install.sh
    cp config.example.yaml config.yaml   # then edit for your providers
    ./di --config config.yaml --check    # validate the stack
    ./di --config config.yaml            # serve

\`di --check\` verifies: config parses, sqlite is writable, web assets are
present, and each provider endpoint responds.

## Notes
- Voice transport is WebSocket (GET /v1/sessions/:id/voice upgrade); only the
  configured STT/TTS/LLM endpoints must be reachable.
`;

// ---------------------------------------------------------------------------
// Per-target staging + archive.
// ---------------------------------------------------------------------------
rmSync(OUT, { recursive: true, force: true });

for (const target of targets) {
  const triple = TRIPLES[target];
  const stage = join(OUT, `di-${version}-${triple}`);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });

  console.log(`==> compiling di for ${target}`);
  const binTmp = join(stage, "di.bin");
  await $`bun build --compile --target ${target} ${join(ROOT, "apps", "server", "src", "cli.ts")} --outfile ${binTmp}`;

  await $`mv ${binTmp} ${join(stage, "di")}`;
  await $`chmod +x ${join(stage, "di")}`;

  console.log(`==> staging web assets`);
  cpSync(spaDir, join(stage, "apps", "web", "dist", "client"), { recursive: true });

  console.log(`==> staging config, installer, README`);
  cpSync(join(ROOT, "config.example.yaml"), join(stage, "config.example.yaml"));
  writeFileSync(join(stage, "install.sh"), installer, { mode: 0o755 });
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
