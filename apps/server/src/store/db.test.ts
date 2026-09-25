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

  it("creates tool_state keyed by session id", async () => {
    const db = createDatabase(":memory:");
    await migrate(db);
    await db
      .insertInto("tool_state")
      .values({
        id: crypto.randomUUID(),
        editor: "e",
        whiteboard: "w",
        updated_at: new Date().toISOString(),
      })
      .execute();
    const rows = await db.selectFrom("tool_state").selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.editor).toBe("e");
  });
});
