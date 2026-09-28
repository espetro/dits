/**
 * Normalizes every locale json in apps/web/src/locales to flat dotted keys.
 * `intl-ai fill` writes new keys as nested objects; the repo convention (and
 * scripts/check-locales.ts) is flat. Run: bun run scripts/flatten-locales.ts
 * Exits 1 if a nested path collides with an existing flat key.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = new URL("../apps/web/src/locales/", import.meta.url).pathname;

function* flat(obj: Record<string, unknown>, prefix = ""): Generator<[string, string]> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") yield [key, v];
    else if (v && typeof v === "object") yield* flat(v as Record<string, unknown>, key);
  }
}

let changed = 0;
let collisions = 0;
for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const path = join(dir, file);
  const raw = readFileSync(path, "utf8");
  const obj = JSON.parse(raw) as Record<string, unknown>;
  const seen = new Map<string, string>();
  for (const [k, v] of flat(obj)) {
    if (seen.has(k) && seen.get(k) !== v) {
      console.error(`${file}: conflicting values for ${k}`);
      collisions++;
    }
    seen.set(k, v);
  }
  const sorted = Object.fromEntries([...seen].sort(([a], [b]) => a.localeCompare(b)));
  const next = `${JSON.stringify(sorted, null, 2)}\n`;
  if (next !== raw) {
    writeFileSync(path, next);
    changed++;
  }
}
if (collisions) process.exit(1);
console.log(`flattened ${changed} file(s)`);
