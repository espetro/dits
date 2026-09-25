# sqlite-vec spike (2026-09-04)

Question: can we use sqlite-vec for vector search inside the `di` server's
bun:sqlite/kysely store, or do we need a JS fallback?

## Result: works, with one macOS caveat

`sqlite-vec@0.1.9` loads into `bun:sqlite` via `sqliteVec.load(db)` **only after
pointing Bun at an extension-capable SQLite build**. Bun on macOS links Apple's
system SQLite, which is compiled with `SQLITE_OMIT_LOAD_EXTENSION`, so
`loadExtension` throws:

```
Error: This build of sqlite3 does not support dynamic extension loading
```

(Confirmed on bun 1.3.14 and 1.4.0; `allowExtension: true` on `new Database()`
is accepted but does not help. Also note `new Database(':memory:',
{ allowExtension: true })` without flags throws
`flags must include SQLITE_OPEN_READONLY or SQLITE_OPEN_READWRITE` before any
of this matters.)

### Fix on macOS

`Database.setCustomSQLite()` must be called **before opening any Database**:

```ts
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";

Database.setCustomSQLite("/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib");
// (existence-check the path first; an invalid path hard-crashes Bun)

const db = new Database(":memory:");
sqliteVec.load(db);
db.exec("CREATE VIRTUAL TABLE items USING vec0(embedding float[4])");
const ins = db.prepare("INSERT INTO items(rowid, embedding) VALUES (?, vec_f32(?))");
ins.run(1, new Float32Array([1, 0, 0, 0]));
ins.run(3, new Float32Array([0.9, 0.1, 0, 0]));
const rows = db
  .prepare(
    "SELECT rowid, distance FROM items WHERE embedding MATCH vec_f32(?) ORDER BY distance LIMIT 2",
  )
  .all(new Float32Array([1, 0, 0, 0]));
// => [{ rowid: 1, distance: 0 }, { rowid: 3, distance: 0.141421377658844 }]
```

Full working code: `packages/evals/src/spike-sqlite-vec.ts`. Pass Float32Array directly
to `.run()` (a raw ArrayBuffer is rejected with "Binding expected string,
TypedArray, ...").

Runtime requirement: Homebrew sqlite (`brew install sqlite`) on macOS. On Linux
Bun's bundled SQLite supports extensions, so `sqliteVec.load(db)` works as-is.

### @aeriondyseti/drizzle-sqlite-vec

Installs and imports cleanly (`vector` column helper, `vectorMatch`,
`vec0Table`, etc. all exported; verified `vector('v', { dimensions: 4 })`
defines a table over drizzle-orm/bun-sqlite). It is a thin SQL-builder layer:
it does not solve the extension-loading problem, which remains the only real
blocker. Kept as a devDependency of `evals` for future evaluation.

## Recommendation

For v1 (small corpora, single process): **use the JS brute-force cosine
fallback** (`packages/evals/src/cosine.ts`, unit tested) storing embeddings as BLOBs in
the existing kysely/bun:sqlite store. It avoids the Homebrew-SQLite runtime
dependency and the extension-loading fragility, and at interview-scale row
counts (<10k chunks) brute force is sub-millisecond in Bun.

Revisit sqlite-vec when corpora grow beyond ~100k vectors or when we need
index-backed ANN. If adopted: add a startup guard that existence-checks
`/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib` before `setCustomSQLite`, and
fall back to brute force (surfacing a warning) when the extension cannot load.
