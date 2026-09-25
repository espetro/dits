import { Kysely, SqliteDialect, sql } from "kysely";
import type { Generated } from "kysely";
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface DbSchema {
  sessions: {
    id: string;
    title: string;
    mode: "interview" | "coach";
    created_at: string;
    status: string;
    duration_min: number;
    plan: string | null;
  };
  turns: {
    id: string;
    session_id: string;
    seq: number;
    speaker: "user" | "agent";
    text: string;
    created_at: string;
    source: "voice" | "text";
  };
  events: {
    id: Generated<number>;
    session_id: string;
    type: string;
    payload: string | null;
    at: string;
  };
  reports: {
    session_id: string;
    overall_score: number;
    coverage_pct: number;
    data: string;
    generated_at: string;
  };
  tool_state: {
    id: string;
    editor: string;
    whiteboard: string;
    updated_at: string;
  };
  documents: {
    id: string;
    session_id: string;
    name: string;
    kind: "pdf" | "md" | "txt" | "docx";
    size_bytes: number;
    status: "pending" | "processing" | "ready" | "failed";
    error: string | null;
    chunk_count: number | null;
    created_at: string;
  };
  chunks: {
    id: string;
    document_id: string;
    session_id: string;
    seq: number;
    text: string;
    embedding: Uint8Array;
  };
}

export type Db = Kysely<DbSchema>;

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    mode TEXT NOT NULL,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'created',
    duration_min INTEGER NOT NULL,
    plan TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS turns (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    seq INTEGER NOT NULL,
    speaker TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    source TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT,
    at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tool_state (
    id TEXT PRIMARY KEY REFERENCES sessions(id),
    editor TEXT NOT NULL DEFAULT '',
    whiteboard TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS reports (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id),
    overall_score INTEGER NOT NULL,
    coverage_pct INTEGER NOT NULL,
    data TEXT NOT NULL,
    generated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    chunk_count INTEGER,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id),
    session_id TEXT NOT NULL REFERENCES sessions(id),
    seq INTEGER NOT NULL,
    text TEXT NOT NULL,
    embedding BLOB NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chunks_session ON chunks(session_id)`,
];

/**
 * bun:sqlite almost satisfies the better-sqlite3 surface Kysely's
 * SqliteDialect consumes, except its Statement has no `reader` property,
 * so Kysely can't tell selects from writes and drops result rows. Wrap
 * prepare() to add it. No better-sqlite3 native dep.
 */
function bunSqliteForKysely(path: string): Database {
  const sqlite = new Database(path);
  sqlite.exec("pragma journal_mode = WAL;");
  const rawPrepare = sqlite.prepare.bind(sqlite);
  // @ts-expect-error augmenting statements with the `reader` flag kysely needs
  sqlite.prepare = (query: string) => {
    const stmt = rawPrepare(query);
    return Object.defineProperty(stmt, "reader", {
      value: /^\s*(select|with|returning|pragma)/i.test(query),
    });
  };
  return sqlite;
}

export function createDatabase(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  return new Kysely<DbSchema>({
    dialect: new SqliteDialect({ database: bunSqliteForKysely(path) as never }),
  });
}

export async function migrate(db: Db): Promise<void> {
  const tables = await db.introspection.getTables();
  const names = new Set(tables.map((t) => t.name));
  for (const m of MIGRATIONS) {
    if (/^CREATE INDEX/i.test(m)) {
      await sql.raw(m).execute(db);
      continue;
    }
    const table = m.match(/CREATE TABLE IF NOT EXISTS (\w+)/)![1]!;
    if (names.has(table)) continue;
    await sql.raw(m).execute(db);
  }
}

export async function ping(db: Db): Promise<boolean> {
  try {
    await sql`select 1`.execute(db);
    return true;
  } catch {
    return false;
  }
}
