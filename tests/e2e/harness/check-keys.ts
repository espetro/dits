// Fails loudly when a storage key in harness/seed.ts no longer exists in the
// app sources (a rename that would otherwise make seeds silently inert).
//   bun harness/check-keys.ts
import { readFileSync } from "node:fs";
import { Glob } from "bun";
import { KEYS } from "./seed";

const root = new URL("../../../", import.meta.url).pathname;
const sources: string[] = [];
for (const dir of ["apps/web/src", "packages/shared/src"]) {
  for (const f of new Glob("**/*.{ts,tsx}").scanSync({ cwd: root + dir })) {
    if (/\.test\.tsx?$/.test(f)) continue;
    sources.push(readFileSync(`${root}${dir}/${f}`, "utf8"));
  }
}
const haystack = sources.join("\n");
const missing = Object.entries(KEYS).filter(([, key]) => !haystack.includes(`"${key}"`));
if (missing.length) {
  console.error(
    `seed keys not found in app sources:\n${missing.map(([n, k]) => `  ${n}: ${k}`).join("\n")}`,
  );
  process.exit(1);
}
console.log(`seed keys ok (${Object.keys(KEYS).length})`);
