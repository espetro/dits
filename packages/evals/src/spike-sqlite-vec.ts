/**
 * sqlite-vec spike: load the vec0 extension into bun:sqlite and run a MATCH query.
 *
 * Result: WORKS, but only after pointing Bun at Homebrew's SQLite on macOS
 * (Apple's system SQLite is compiled with SQLITE_OMIT_LOAD_EXTENSION).
 * See .agents/notes/2026-09-04-sqlite-vec-spike.md
 *
 * Run with: bun run packages/evals/src/spike-sqlite-vec.ts
 */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import * as sqliteVec from "sqlite-vec";

function useExtensionCapableSqlite(): void {
  if (process.platform !== "darwin") return;
  const candidates = [
    "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
    "/usr/local/opt/sqlite/lib/libsqlite3.dylib",
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    Database.setCustomSQLite(path);
    return;
  }
  throw new Error(`no Homebrew sqlite found; tried: ${candidates.join(", ")}`);
}

export function spikeVec(): { rowid: number; distance: number }[] {
  useExtensionCapableSqlite();
  const db = new Database(":memory:");
  sqliteVec.load(db);
  db.exec("CREATE VIRTUAL TABLE items USING vec0(embedding float[4])");
  const ins = db.prepare("INSERT INTO items(rowid, embedding) VALUES (?, vec_f32(?))");
  ins.run(1, new Float32Array([1, 0, 0, 0]));
  ins.run(2, new Float32Array([0, 1, 0, 0]));
  ins.run(3, new Float32Array([0.9, 0.1, 0, 0]));
  return db
    .prepare(
      "SELECT rowid, distance FROM items WHERE embedding MATCH vec_f32(?) ORDER BY distance LIMIT 2",
    )
    .all(new Float32Array([1, 0, 0, 0])) as {
    rowid: number;
    distance: number;
  }[];
}

if (import.meta.main) {
  console.log("sqlite-vec spike result:", spikeVec());
}
