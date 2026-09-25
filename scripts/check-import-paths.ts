#!/usr/bin/env bun
/**
 * Resolves every relative import/export specifier in packages/shared, apps/server, apps/web, packages/evals
 * src against the filesystem. oxlint 1.80 has no import/no-unresolved, so
 * this is the T0 guard for a wrong relative path (e.g. apps/web/src/lib/voice
 * importing "../stores/session" when the file lives at "../../stores/session").
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const specifierRe = /(?:from|import)\s*(?:type\s+)?["']([^"']+)["']/g;
const EXTS = [".ts", ".tsx", ".d.ts"];

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listSourceFiles(full));
    else if (EXTS.includes(extname(full))) out.push(full);
  }
  return out;
}

function resolves(fromFile: string, specifier: string): boolean {
  const base = resolve(dirname(fromFile), specifier);
  if (existsSync(base) && statSync(base).isFile()) return true;
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    if (existsSync(base + ext)) return true;
  }
  return false;
}

const explicitFiles = process.argv.slice(2).filter((a) => !a.startsWith("-"));

const files =
  explicitFiles.length > 0
    ? explicitFiles.map((f) => resolve(root, f)).filter(existsSync)
    : ["packages/shared/src", "apps/server/src", "apps/web/src", "packages/evals/src"]
        .map((ws) => join(root, ws))
        .filter(existsSync)
        .flatMap(listSourceFiles);

const offenders: string[] = [];
for (const file of files) {
  const text = await Bun.file(file).text();
  for (const match of text.matchAll(specifierRe)) {
    const specifier = match[1]!;
    if (!specifier.startsWith(".")) continue;
    if (!resolves(file, specifier)) {
      offenders.push(`${file.replace(root, "")}: unresolved import "${specifier}"`);
    }
  }
}

if (offenders.length > 0) {
  console.error(offenders.join("\n"));
  process.exit(1);
}
console.log("OK: every relative import resolves");
