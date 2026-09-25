import { Hono } from "hono";
import type { Db } from "../store/db";

/** Voice pipeline stages, in the order the WS voice loop emits them. */
const PIPELINE_STAGES = new Set([
  "agent.started",
  "vad.speech_ended",
  "stt.request",
  "stt.result",
  "stt.failed",
  "llm.request",
  "llm.result",
  "tts.request",
  "tts.result",
  "tts.failed",
]);
const TERMINAL_STAGE = "tts.result";

/**
 * Derive where a session's voice pipeline last progressed, from the ordered
 * list of pipeline-stage event types (already filtered to PIPELINE_STAGES,
 * in event-id/arrival order — not deduped or reordered). null means the
 * chain reached its terminal stage, or never started.
 */
export function deriveStalledAt(stageTypes: readonly string[]): string | null {
  const last = stageTypes[stageTypes.length - 1];
  return last === undefined || last === TERMINAL_STAGE ? null : last;
}

/**
 * Debug routes, mounted only when DI_TEST_MODE=1.
 * Agents drive the app by URL and assert against these endpoints instead of DOM scraping.
 */
export function testRoutes(db: Db): Hono {
  const t = new Hono();

  // Serialized server state (sessions, reports) for fetch-based assertions.
  t.get("/state", async (c) => {
    const sessions = await db.selectFrom("sessions").selectAll().execute();
    const reports = await db.selectFrom("reports").selectAll().execute();
    return c.json({
      sessions,
      reports: reports.map((r) => ({
        session_id: r.session_id,
        data: JSON.parse(r.data),
      })),
    });
  });

  // Session event log (worker lifecycle, agent turns) for assertions.
  t.get("/events", async (c) => {
    const sessionId = c.req.query("session_id");
    let q = db.selectFrom("events").selectAll().orderBy("id");
    if (sessionId) q = q.where("session_id", "=", sessionId);
    const events = await q.execute();
    return c.json(
      events.map((e) => ({
        session_id: e.session_id,
        type: e.type,
        payload: e.payload === null ? undefined : JSON.parse(e.payload),
        at: e.at,
      })),
    );
  });

  // Probe that test mode is actually on; inert binary 404s this route.
  t.get("/ping", (c) => c.json({ testMode: true }));

  // Ordered voice pipeline dataflow view for a single session: which stages
  // fired and where the chain last progressed. One curl instead of grepping
  // .di/logs/ for the worker's per-stage events.
  t.get("/pipeline/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    const events = await db
      .selectFrom("events")
      .selectAll()
      .where("session_id", "=", sessionId)
      .orderBy("id")
      .execute();
    const stages = events
      .filter((e) => PIPELINE_STAGES.has(e.type))
      .map((e) => ({
        stage: e.type,
        payload: e.payload === null ? undefined : JSON.parse(e.payload),
        at: e.at,
      }));
    return c.json({
      session_id: sessionId,
      stages,
      stalled_at: deriveStalledAt(stages.map((s) => s.stage)),
    });
  });

  // End-to-end storage round trip: create session, post a turn, read it back.
  // No DELETE route exists for sessions, so the smoke session is left behind.
  t.get("/smoke", async (c) => {
    const start = performance.now();
    try {
      const session = {
        id: crypto.randomUUID(),
        title: `smoke-${Date.now()}`,
        mode: "interview" as const,
        created_at: new Date().toISOString(),
        status: "created" as const,
        duration_min: 5,
        plan: null,
      };
      await db.insertInto("sessions").values(session).execute();

      const turn = {
        id: crypto.randomUUID(),
        session_id: session.id,
        speaker: "user" as const,
        text: "smoke test turn",
        created_at: new Date().toISOString(),
        source: "text" as const,
      };
      await db
        .insertInto("turns")
        .values({ ...turn, seq: 0 })
        .execute();

      const persisted = await db
        .selectFrom("turns")
        .selectAll()
        .where("session_id", "=", session.id)
        .execute();
      if (persisted.length !== 1 || persisted[0]?.id !== turn.id) {
        throw new Error("turn did not persist");
      }

      return c.json({
        ok: true,
        latency_ms: Math.round(performance.now() - start),
        session_id: session.id,
      });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  return t;
}
