import { Hono } from "hono";
import * as v from "valibot";
import {
  CreateSessionRequestSchema,
  DocumentSchema,
  ReportSchema,
  SessionContextResponseSchema,
  SessionEventSchema,
  SessionSchema,
  ToolStateSchema,
  TurnSchema,
} from "@di/shared";
import { vValidator } from "@hono/valibot-validator";
import type { Db } from "../store/db";
import { testRoutes } from "./test-mode";
import {
  CapError,
  deleteDocument,
  ingestDocuments,
  listDocuments,
  loadVectors,
} from "../rag/ingest";
import { retrieve } from "../rag/embeddings";

const TurnInputSchema = v.omit(TurnSchema, ["session_id"]);

/**
 * /v1/* REST API. Valibot-validated request/response contracts from @di/shared.
 * In DI_TEST_MODE extra debug routes under /v1/test/* are mounted (see test-mode.ts).
 */
export function apiRoutes(
  db: Db,
  opts: {
    testMode: boolean;
    embeddings?: ReturnType<typeof import("../rag/ingest").embeddingsClientFromConfig>;
  },
): Hono {
  const api = new Hono();

  api.post("/sessions", vValidator("json", CreateSessionRequestSchema), async (c) => {
    const body = c.req.valid("json");
    const session = {
      id: crypto.randomUUID(),
      title: body.title,
      mode: body.mode,
      created_at: new Date().toISOString(),
      status: "created",
      duration_min: body.duration_min,
      plan: null,
    };
    await db.insertInto("sessions").values(session).execute();
    return c.json(v.parse(SessionSchema, { ...session, plan: undefined }), 201, {
      Location: `/v1/sessions/${session.id}`,
    });
  });

  api.get("/sessions", async (c) => {
    const rows = await db.selectFrom("sessions").selectAll().execute();
    return c.json(rows.map((r) => v.parse(SessionSchema, { ...r, plan: r.plan ?? undefined })));
  });

  api.get("/sessions/:id", async (c) => {
    const row = await db
      .selectFrom("sessions")
      .selectAll()
      .where("id", "=", c.req.param("id"))
      .executeTakeFirst();
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json(v.parse(SessionSchema, { ...row, plan: row.plan ?? undefined }));
  });

  api.post("/sessions/:id/turns", vValidator("json", TurnInputSchema), async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");
    const session = await db
      .selectFrom("sessions")
      .select("id")
      .where("id", "=", id)
      .executeTakeFirst();
    if (!session) return c.json({ error: "not found" }, 404);
    // The server owns sequencing: concurrent writers (voice worker, text
    // input, tests) cannot agree on the next seq among themselves.
    const { max_seq } = await db
      .selectFrom("turns")
      .select((eb) => eb.fn.coalesce(eb.fn.max("seq"), eb.lit(-1)).as("max_seq"))
      .where("session_id", "=", id)
      .executeTakeFirstOrThrow();
    const turn = { ...body, session_id: id, seq: Number(max_seq) + 1 };
    await db.insertInto("turns").values(turn).execute();
    return c.json(v.parse(TurnSchema, turn), 201);
  });

  api.get("/sessions/:id/turns", async (c) => {
    const rows = await db
      .selectFrom("turns")
      .selectAll()
      .where("session_id", "=", c.req.param("id"))
      .orderBy("seq")
      .execute();
    return c.json(rows.map((r) => v.parse(TurnSchema, r)));
  });

  api.post("/sessions/:id/events", vValidator("json", SessionEventSchema), async (c) => {
    const evt = c.req.valid("json");
    await db
      .insertInto("events")
      .values({
        session_id: evt.session_id,
        type: evt.type,
        payload: evt.payload === undefined ? null : JSON.stringify(evt.payload),
        at: evt.at,
      })
      .execute();
    return c.json({ ok: true }, 201);
  });

  api.put("/sessions/:id/tools", vValidator("json", ToolStateSchema), async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");
    const session = await db
      .selectFrom("sessions")
      .select("id")
      .where("id", "=", id)
      .executeTakeFirst();
    if (!session) return c.json({ error: "not found" }, 404);
    const row = {
      id,
      editor: body.editor,
      whiteboard: body.whiteboard,
      updated_at: new Date().toISOString(),
    };
    await db
      .insertInto("tool_state")
      .values(row)
      .onConflict((oc) =>
        oc.column("id").doUpdateSet({
          editor: row.editor,
          whiteboard: row.whiteboard,
          updated_at: row.updated_at,
        }),
      )
      .execute();
    return c.json({ ok: true });
  });

  api.get("/sessions/:id/tools", async (c) => {
    const row = await db
      .selectFrom("tool_state")
      .selectAll()
      .where("id", "=", c.req.param("id"))
      .executeTakeFirst();
    if (!row) return c.json({ editor: "", whiteboard: "" });
    return c.json(v.parse(ToolStateSchema, row));
  });

  api.put("/sessions/:id/report", vValidator("json", ReportSchema), async (c) => {
    const id = c.req.param("id");
    const report = c.req.valid("json");
    if (report.session_id !== id) return c.json({ error: "session id mismatch" }, 400);
    await db
      .insertInto("reports")
      .values({
        session_id: id,
        overall_score: report.overall_score,
        coverage_pct: report.coverage_pct,
        data: JSON.stringify(report),
        generated_at: report.generated_at,
      })
      .onConflict((oc) => oc.column("session_id").doUpdateSet({ data: JSON.stringify(report) }))
      .execute();
    await db.updateTable("sessions").set({ status: "reported" }).where("id", "=", id).execute();
    return c.json({ ok: true });
  });

  api.get("/sessions/:id/report", async (c) => {
    const row = await db
      .selectFrom("reports")
      .selectAll()
      .where("session_id", "=", c.req.param("id"))
      .executeTakeFirst();
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json(JSON.parse(row.data));
  });

  // Voice WebSocket endpoint. Bun upgrades this in serveApp before the Hono
  // app sees it; this route only handles non-upgrade requests (documented
  // in .agents/docs, not openapi.json).
  api.get("/sessions/:id/voice", (c) => c.json({ error: "websocket upgrade required" }, 426));

  api.post("/sessions/:id/documents", async (c) => {
    const sessionId = c.req.param("id");
    const session = await db
      .selectFrom("sessions")
      .select("id")
      .where("id", "=", sessionId)
      .executeTakeFirst();
    if (!session) return c.json({ error: "session not found" }, 404);
    const form = await c.req.formData();
    const files: { name: string; bytes: Uint8Array }[] = [];
    for (const value of form.getAll("file")) {
      if (!(value instanceof File)) continue;
      files.push({
        name: value.name,
        bytes: new Uint8Array(await value.arrayBuffer()),
      });
    }
    if (files.length === 0) return c.json({ error: "no files uploaded (field: file)" }, 400);
    try {
      const docs = await ingestDocuments(db, sessionId, files, {
        embeddings: opts.embeddings,
      });
      return c.json({ documents: docs.map((d) => v.parse(DocumentSchema, d)) }, 201);
    } catch (err) {
      if (err instanceof CapError) return c.json({ error: err.message }, err.status);
      throw err;
    }
  });

  api.get("/sessions/:id/documents", async (c) => {
    const docs = await listDocuments(db, c.req.param("id"));
    return c.json({ documents: docs });
  });

  api.delete("/sessions/:id/documents/:docId", async (c) => {
    const ok = await deleteDocument(db, c.req.param("id"), c.req.param("docId"));
    return ok ? c.body(null, 204) : c.json({ error: "document not found" }, 404);
  });

  api.get("/sessions/:id/context", async (c) => {
    const sessionId = c.req.param("id");
    const session = await db
      .selectFrom("sessions")
      .select("id")
      .where("id", "=", sessionId)
      .executeTakeFirst();
    if (!session) return c.json({ error: "session not found" }, 404);
    const query = c.req.query("query") ?? "";
    const rows = await loadVectors(db, sessionId);
    if (!query || rows.length === 0) {
      const chunks = rows.slice(0, 8).map((r) => ({
        document_id: r.document_id,
        document_name: r.document_name,
        seq: r.seq,
        text: r.text,
        score: 0,
      }));
      return c.json(v.parse(SessionContextResponseSchema, { chunks }));
    }
    if (!opts.embeddings) return c.json({ error: "no embeddings provider configured" }, 503);
    const [queryVec] = await opts.embeddings.embed([query]);
    const chunks = retrieve(queryVec!, rows, 8);
    return c.json(v.parse(SessionContextResponseSchema, { chunks }));
  });

  if (opts.testMode) {
    api.route("/test", testRoutes(db));
  }

  return api;
}
