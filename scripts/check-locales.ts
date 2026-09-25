/**
 * Advisory locale consistency checker: every locale file in apps/web/src/locales
 * must have the exact same key set as en.json, non-empty values, and matching
 * {interpolation} placeholders. Run: bun run scripts/check-locales.ts
 * Exit code 1 on any error (advisory in CI — see .github/workflows/intl.yml).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = new URL("../apps/web/src/locales/", import.meta.url).pathname;
const en = JSON.parse(readFileSync(join(dir, "en.json"), "utf8")) as Record<string, string>;
const enKeys = Object.keys(en).sort();

const PLACEHOLDER = /\{(\w+)\}/g;
const placeholders = (s: string) =>
  [...s.matchAll(PLACEHOLDER)]
    .map((m) => m[1])
    .sort()
    .join(",");

let failures = 0;
const fail = (msg: string) => {
  console.error(`  ✗ ${msg}`);
  failures++;
};

for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "en.json")) {
  const loc = file.replace(/\.json$/, "");
  const msgs = JSON.parse(readFileSync(join(dir, file), "utf8")) as Record<string, string>;
  const keys = Object.keys(msgs).sort();
  console.log(`== ${loc} (${keys.length} keys)`);

  const missing = enKeys.filter((k) => !keys.includes(k));
  const extra = keys.filter((k) => !enKeys.includes(k));
  if (missing.length) fail(`missing keys: ${missing.join(", ")}`);
  if (extra.length) fail(`extra keys: ${extra.join(", ")}`);

  for (const [k, v] of Object.entries(msgs)) {
    if (typeof v !== "string" || !v.trim()) fail(`empty value: ${k}`);
  }
  for (const k of enKeys) {
    if (k in msgs && placeholders(en[k]) !== placeholders(msgs[k])) {
      fail(
        `interpolation mismatch on ${k}: en <${placeholders(en[k])}> vs ${loc} <${placeholders(msgs[k])}>`,
      );
    }
  }
}

console.log(
  `en.json: ${enKeys.length} keys across ${enKeys.length ? new Set(enKeys.map((k) => k.split(".")[0])).size : 0} namespaces`,
);
if (failures) {
  console.error(`\nintl check failed with ${failures} problem(s)`);
  process.exit(1);
}
console.log("intl check passed");
