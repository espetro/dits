import { describe, expect, it } from "vitest";
import { createDatabase, migrate, ping } from "./db";

describe("db", () => {
  it("migrates an in-memory db and accepts queries", async () => {
    const db = createDatabase(":memory:");
    await migrate(db);
    expect(await ping(db)).toBe(true);
    await db
      .insertInto("sessions")
      .values({
        id: crypto.randomUUID(),
        title: "t",
        mode: "interview",
        created_at: new Date().toISOString(),
        status: "created",
        duration_min: 30,
        plan: null,
        tools: "{}",
      })
      .execute();
    const rows = await db.selectFrom("sessions").selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("created");
  });

  it("migrations are idempotent", async () => {
    const db = createDatabase(":memory:");
    await migrate(db);
    await migrate(db);
  });

  it("creates tool_states keyed by (session, tool)", async () => {
    const db = createDatabase(":memory:");
    await migrate(db);
    const sessionId = crypto.randomUUID();
    const entries: [string, string][] = [
      ["editor", "e"],
      ["whiteboard", "w"],
    ];
    for (const [tool, state] of entries) {
      await db
        .insertInto("tool_states")
        .values({
          session_id: sessionId,
          tool,
          state,
          updated_at: new Date().toISOString(),
        })
        .execute();
    }
    const rows = await db
      .selectFrom("tool_states")
      .selectAll()
      .where("session_id", "=", sessionId)
      .orderBy("tool")
      .execute();
    expect(rows.map((r) => [r.tool, r.state])).toEqual([
      ["editor", "e"],
      ["whiteboard", "w"],
    ]);
  });
});
