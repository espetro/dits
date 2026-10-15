import { sql } from "kysely";
import type { Db } from "./db";

/** Child tables first: FK order for `sessions` (events carries no FK but is session scoped). */
const SESSION_CHILD_TABLES = [
  "chunks",
  "documents",
  "reports",
  "tool_states",
  "events",
  "turns",
] as const;

/** Delete one session and everything hanging off it. False when it does not exist. */
export async function deleteSession(db: Db, id: string): Promise<boolean> {
  return db.transaction().execute(async (trx) => {
    for (const table of SESSION_CHILD_TABLES) {
      await trx.deleteFrom(table).where("session_id", "=", id).execute();
    }
    const res = await trx.deleteFrom("sessions").where("id", "=", id).executeTakeFirst();
    return Number(res.numDeletedRows) > 0;
  });
}

/**
 * Wipe every row, then checkpoint the WAL and VACUUM so the file actually
 * shrinks (and deleted interview content is not left in free pages).
 * Returns how many sessions were removed.
 */
export async function deleteAllData(db: Db): Promise<number> {
  const removed = await db.transaction().execute(async (trx) => {
    for (const table of SESSION_CHILD_TABLES) await trx.deleteFrom(table).execute();
    const res = await trx.deleteFrom("sessions").executeTakeFirst();
    return Number(res.numDeletedRows);
  });
  await sql`PRAGMA wal_checkpoint(TRUNCATE)`.execute(db);
  await sql`VACUUM`.execute(db);
  return removed;
}
