import { Hono } from "hono";
import type { Context } from "hono";
import * as v from "valibot";
import {
  CreateSessionRequestSchema,
  DEFAULT_SESSION_TOOLS,
  DocumentSchema,
  RelayQuerySchema,
  ReportSchema,
  SessionContextResponseSchema,
  SessionEventSchema,
  SessionSchema,
  ToolStateSchema,
  TurnSchema,
  UpdateSessionRequestSchema,
} from "@di/shared";
import { vValidator } from "@hono/valibot-validator";
import type { Db } from "../store/db";
import type { Config, DataResetResponse } from "@di/shared";
import { writeFile } from "node:fs/promises";
import type { ReportLlm } from "../report/generate";
import { generateReport } from "../report/generate";
import { testRoutes } from "./test-mode";
import { deleteAllData, deleteSession } from "../store/reset";
import {
  CapError,
  deleteDocument,
  ingestDocuments,
  listDocuments,
  loadVectors,
} from "../rag/ingest";
import { retrieve } from "../rag/embeddings";
import { decodeWav, encodeWav, resamplePcm16 } from "../voice/stt";
import {
  builtinModelsStatus,
  builtinPullProgress,
  builtinModelsDir,
  clearBuiltinModels,
  ensureBuiltinModels,
} from "../voice/builtin/models.ts";

/** The slice of a tts adapter the test route needs: text in, pcm16 mono 24k out. */
export interface TtsTestPort {
  synthesizeToPcm(text: string, opts?: { signal?: AbortSignal }): Promise<Uint8Array>;
}

/** The slice of a stt adapter the test route needs: pcm16le mono 16k in, text out. */
export interface SttTestPort {
  transcribePcm(pcm: Uint8Array, opts?: { signal?: AbortSignal }): Promise<string>;
}

const STT_TEST_RATE = 16_000;
/** ~30s of 16k pcm16 mono; the settings test records ~6s. */
const STT_TEST_MAX_BYTES = STT_TEST_RATE * 2 * 30;

const TTS_TEST_RATE = 24_000;
const TTS_TEST_MAX_CHARS = 280;

const TurnInputSchema = v.omit(TurnSchema, ["session_id"]);

/** Request headers the relay forwards upstream; everything else (cookies, origin, ...) is dropped. */
const RELAY_FORWARD_HEADERS = ["authorization", "content-type", "cf-turnstile-response"] as const;

interface RelayUpstreamInit {
  method: string;
  headers: Record<string, string>;
  body: ReadableStream<unknown> | null;
  signal: AbortSignal | null;
  redirect: RequestRedirect;
}

function relayForwardHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of RELAY_FORWARD_HEADERS) {
    const value = req.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  return headers;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

class RelayUpstreamError extends Error {
  constructor(cause: unknown) {
    super(`upstream fetch failed: ${cause}`);
    this.cause = cause;
  }
}

/** Streams a relayed Response with content-type only; null body degrades to empty. */
function relayResponse(c: Context, upstream: Response): Response {
  const contentType = upstream.headers.get("content-type");
  const headers: Record<string, string> = {};
  if (contentType) headers["content-type"] = contentType;
  // upstream.body is null only for empty upstream responses (204/304, HEAD),
  // where an empty body is already the correct response. Hono's c.body
  // overloads reject mixed shapes, so build the Response directly.
  return new Response(upstream.body, { status: upstream.status, headers });
}

async function relayFetchUpstream(upstream: string, init: RelayUpstreamInit): Promise<Response> {
  try {
    return await fetch(upstream, init);
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new RelayUpstreamError(err);
  }
}

/** sessions.tools is stored as JSON text; absent pre-p3 rows mean the default toolset. */
function parseSessionTools(raw: string | null | undefined): Record<string, string> {
  if (!raw) return { ...DEFAULT_SESSION_TOOLS };
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = v.safeParse(ToolStateSchema, parsed);
    const tools = result.success ? result.output : {};
    return Object.keys(tools).length > 0 ? tools : { ...DEFAULT_SESSION_TOOLS };
  } catch {
    return { ...DEFAULT_SESSION_TOOLS };
  }
}

/**
 * /v1/* REST API. Valibot-validated request/response contracts from @di/shared.
 * In DI_TEST_MODE extra debug routes under /v1/test/* are mounted (see test-mode.ts).
 */
export function apiRoutes(
  db: Db,
  opts: {
    testMode: boolean;
    embeddings?: ReturnType<typeof import("../rag/ingest").embeddingsClientFromConfig>;
    /** LLM port for POST /sessions/:id/report; without it the route is 503. */
    reportLlm?: ReportLlm;
    /** config.documents overrides for ingest caps/chunking/retrieval depth. */
    documents?: Config["documents"];
    /** builtin-voice model management (GET/POST/DELETE /voice/models). */
    voiceModels?: {
      providers: { stt: "remote" | "builtin"; tts: "remote" | "builtin" };
      dataDir: string;
      /** lazily builds the configured tts adapter (cached by the caller) for POST /voice/tts-test. */
      tts?: () => TtsTestPort;
      /** lazily builds the configured stt adapter (cached by the caller) for POST /voice/stt-test. */
      stt?: () => SttTestPort;
    };
    /** log file truncated by DELETE /data; empty/undefined = logging disabled. */
    logPath?: string;
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
      prompt: body.prompt ?? null,
      tools: JSON.stringify(body.tools ?? DEFAULT_SESSION_TOOLS),
    };
    await db.insertInto("sessions").values(session).execute();
    return c.json(
      v.parse(SessionSchema, {
        ...session,
        plan: undefined,
        prompt: session.prompt ?? undefined,
        tools: parseSessionTools(session.tools),
      }),
      201,
      {
        Location: `/v1/sessions/${session.id}`,
      },
    );
  });

  api.get("/sessions", async (c) => {
    const rows = await db.selectFrom("sessions").selectAll().execute();
    return c.json(
      rows.map((r) =>
        v.parse(SessionSchema, {
          ...r,
          plan: r.plan ?? undefined,
          prompt: r.prompt ?? undefined,
          tools: parseSessionTools(r.tools),
        }),
      ),
    );
  });

  api.get("/sessions/:id", async (c) => {
    const row = await db
      .selectFrom("sessions")
      .selectAll()
      .where("id", "=", c.req.param("id"))
      .executeTakeFirst();
    if (!row) return c.json({ error: "not found", code: "not_found" }, 404);
    return c.json(
      v.parse(SessionSchema, {
        ...row,
        plan: row.plan ?? undefined,
        prompt: row.prompt ?? undefined,
        tools: parseSessionTools(row.tools),
      }),
    );
  });

  api.patch("/sessions/:id", vValidator("json", UpdateSessionRequestSchema), async (c) => {
    const id = c.req.param("id");
    const { status } = c.req.valid("json");
    const res = await db
      .updateTable("sessions")
      .set({ status })
      .where("id", "=", id)
      .executeTakeFirst();
    if (Number(res.numUpdatedRows) === 0)
      return c.json({ error: "not found", code: "not_found" }, 404);
    const row = await db
      .selectFrom("sessions")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    return c.json(
      v.parse(SessionSchema, {
        ...row,
        plan: row.plan ?? undefined,
        prompt: row.prompt ?? undefined,
        tools: parseSessionTools(row.tools),
      }),
    );
  });

  api.delete("/sessions/:id", async (c) => {
    const ok = await deleteSession(db, c.req.param("id"));
    return ok ? c.body(null, 204) : c.json({ error: "not found", code: "not_found" }, 404);
  });

  /**
   * Full server-side reset: every interview row, the builtin voice model
   * cache and the log file. Destructive; the web Settings "Data" pane is the
   * only caller and gates it behind a typed confirmation.
   */
  api.delete("/data", async (c) => {
    const sessions = await deleteAllData(db);
    if (opts.voiceModels) await clearBuiltinModels(opts.voiceModels.dataDir);
    if (opts.logPath) await writeFile(opts.logPath, "").catch(() => undefined);
    return c.json({ ok: true as const, sessions } satisfies DataResetResponse);
  });

  api.post("/sessions/:id/turns", vValidator("json", TurnInputSchema), async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");
    const session = await db
      .selectFrom("sessions")
      .select("id")
      .where("id", "=", id)
      .executeTakeFirst();
    if (!session) return c.json({ error: "not found", code: "not_found" }, 404);
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
    if (!session) return c.json({ error: "not found", code: "not_found" }, 404);
    const now = new Date().toISOString();
    for (const [tool, state] of Object.entries(body)) {
      await db
        .insertInto("tool_states")
        .values({ session_id: id, tool, state, updated_at: now })
        .onConflict((oc) =>
          oc.columns(["session_id", "tool"]).doUpdateSet({ state, updated_at: now }),
        )
        .execute();
    }
    return c.json({ ok: true });
  });

  api.get("/sessions/:id/tools", async (c) => {
    const rows = await db
      .selectFrom("tool_states")
      .select(["tool", "state"])
      .where("session_id", "=", c.req.param("id"))
      .execute();
    const state: Record<string, string> = {};
    for (const r of rows) state[r.tool] = r.state;
    return c.json(state);
  });

  /**
   * Generate (or return the existing) report via the configured LLM. This is
   * the path the SPA's finish -> report flow uses in server mode: reports
   * are produced here, PUT only stores externally-supplied ones.
   */
  api.post("/sessions/:id/report", async (c) => {
    const id = c.req.param("id");
    const session = await db
      .selectFrom("sessions")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    if (!session) return c.json({ error: "not found", code: "not_found" }, 404);
    const existing = await db
      .selectFrom("reports")
      .select("data")
      .where("session_id", "=", id)
      .executeTakeFirst();
    if (existing) return c.json(JSON.parse(existing.data));
    if (!opts.reportLlm)
      return c.json(
        { error: "report generation is not configured", code: "report_unconfigured" },
        503,
      );
    const turns = await db
      .selectFrom("turns")
      .selectAll()
      .where("session_id", "=", id)
      .orderBy("seq")
      .execute();
    let report;
    try {
      report = await generateReport(opts.reportLlm, {
        sessionId: id,
        title: session.title,
        mode: session.mode,
        turns: turns.map((t) => v.parse(TurnSchema, t)),
      });
    } catch (err) {
      console.error(`[report] generation failed for ${id}: ${err}`);
      return c.json({ error: "report generation failed", code: "report_failed" }, 502);
    }
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
    return c.json(report, 201);
  });

  api.put("/sessions/:id/report", vValidator("json", ReportSchema), async (c) => {
    const id = c.req.param("id");
    const report = c.req.valid("json");
    if (report.session_id !== id)
      return c.json({ error: "session id mismatch", code: "session_id_mismatch" }, 400);
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
    if (!row) return c.json({ error: "not found", code: "not_found" }, 404);
    return c.json(JSON.parse(row.data));
  });

  /**
   * Streaming passthrough relay for browser-mode provider calls (the SPA
   * cannot fetch openrouter/bifrost/... cross-origin). Method and body stream
   * through untouched so the client-side SSE parsing is reused verbatim;
   * only the allowlisted headers cross the boundary. Keys are never logged.
   */
  api.all(
    "/relay",
    vValidator("query", RelayQuerySchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: "invalid url query parameter", code: "relay_bad_url" }, 400);
      }
    }),
    async (c) => {
      const { url: upstream } = c.req.valid("query");
      const init: RelayUpstreamInit = {
        method: c.req.method,
        headers: relayForwardHeaders(c.req.raw),
        body: c.req.raw.body,
        signal: c.req.raw.signal,
        redirect: "manual",
      };
      let upstreamRes: Response;
      try {
        upstreamRes = await relayFetchUpstream(upstream, init);
      } catch (err) {
        if (err instanceof RelayUpstreamError) {
          // network-level failure (dns, refused, tls), not a client abort
          return c.json({ error: "upstream fetch failed", code: "relay_upstream" }, 502);
        }
        // client abort: rethrow so Bun tears down the socket alongside the
        // already-aborted upstream request (fetch shares c.req.raw.signal).
        throw err;
      }
      return relayResponse(c, upstreamRes);
    },
  );

  // Voice WebSocket endpoint. Bun upgrades this in serveApp before the Hono
  // app sees it; this route only handles non-upgrade requests (documented
  // in .agents/docs, not openapi.json).
  api.get("/sessions/:id/voice", (c) =>
    c.json({ error: "websocket upgrade required", code: "upgrade_required" }, 426),
  );

  api.post("/sessions/:id/documents", async (c) => {
    const sessionId = c.req.param("id");
    const session = await db
      .selectFrom("sessions")
      .select("id")
      .where("id", "=", sessionId)
      .executeTakeFirst();
    if (!session) return c.json({ error: "session not found", code: "session_not_found" }, 404);
    const form = await c.req.formData();
    const files: { name: string; bytes: Uint8Array }[] = [];
    for (const value of form.getAll("file")) {
      if (!(value instanceof File)) continue;
      files.push({
        name: value.name,
        bytes: new Uint8Array(await value.arrayBuffer()),
      });
    }
    if (files.length === 0)
      return c.json({ error: "no files uploaded (field: file)", code: "no_files" }, 400);
    try {
      const docs = await ingestDocuments(db, sessionId, files, {
        embeddings: opts.embeddings,
        documents: opts.documents,
      });
      return c.json({ documents: docs.map((d) => v.parse(DocumentSchema, d)) }, 201);
    } catch (err) {
      if (err instanceof CapError)
        return c.json({ error: err.message, code: err.code }, err.status);
      throw err;
    }
  });

  api.get("/sessions/:id/documents", async (c) => {
    const docs = await listDocuments(db, c.req.param("id"));
    return c.json({ documents: docs });
  });

  api.delete("/sessions/:id/documents/:docId", async (c) => {
    const ok = await deleteDocument(db, c.req.param("id"), c.req.param("docId"));
    return ok
      ? c.body(null, 204)
      : c.json({ error: "document not found", code: "document_not_found" }, 404);
  });

  api.get("/sessions/:id/context", async (c) => {
    const sessionId = c.req.param("id");
    const session = await db
      .selectFrom("sessions")
      .select("id")
      .where("id", "=", sessionId)
      .executeTakeFirst();
    if (!session) return c.json({ error: "session not found", code: "session_not_found" }, 404);
    const query = c.req.query("query") ?? "";
    const topK = opts.documents?.context_top_k ?? 8;
    const rows = await loadVectors(db, sessionId);
    if (!query || rows.length === 0) {
      const chunks = rows.slice(0, topK).map((r) => ({
        document_id: r.document_id,
        document_name: r.document_name,
        seq: r.seq,
        text: r.text,
        score: 0,
      }));
      return c.json(v.parse(SessionContextResponseSchema, { chunks }));
    }
    if (!opts.embeddings)
      return c.json({ error: "no embeddings provider configured", code: "no_embeddings" }, 503);
    const [queryVec] = await opts.embeddings.embed([query]);
    const chunks = retrieve(queryVec!, rows, topK);
    return c.json(v.parse(SessionContextResponseSchema, { chunks }));
  });

  const voiceModels = opts.voiceModels;
  if (voiceModels) {
    const status = async () => ({
      providers: voiceModels.providers,
      models: await builtinModelsStatus(voiceModels.dataDir),
      dir: builtinModelsDir(voiceModels.dataDir),
      download: builtinPullProgress(),
    });

    api.get("/voice/models", async (c) => c.json(await status()));

    api.post("/voice/models/pull", async (c) => {
      const ids = (["stt", "tts"] as const).filter((k) => voiceModels.providers[k] === "builtin");
      if (ids.length === 0) return c.json({ error: "no builtin providers" }, 400);
      // idempotent: shares the inflight run with the boot warm / lazy boot
      await ensureBuiltinModels(voiceModels.dataDir, { modelIds: ids });
      return c.json(await status());
    });

    // desktop tts test: really synthesizes through the configured server
    // layer (builtin kitten or remote endpoint) so the settings Test button
    // measures the same path an interview uses
    api.post("/voice/tts-test", async (c) => {
      if (!voiceModels.tts)
        return c.json({ error: "tts test unavailable", code: "tts_test_off" }, 503);
      const body = (await c.req.json().catch(() => ({}))) as { text?: unknown };
      const text =
        typeof body.text === "string" ? body.text.trim().slice(0, TTS_TEST_MAX_CHARS) : "";
      if (!text) return c.json({ error: "text required", code: "tts_test_bad_text" }, 400);
      const startedAt = performance.now();
      try {
        const pcm = await voiceModels.tts().synthesizeToPcm(text, { signal: c.req.raw.signal });
        if (pcm.byteLength === 0)
          return c.json({ error: "tts returned no audio", code: "tts_empty" }, 502);
        const wav = encodeWav([pcm], { sampleRate: TTS_TEST_RATE, channels: 1 });
        return new Response(new Uint8Array(wav), {
          headers: {
            "content-type": "audio/wav",
            "x-synth-ms": String(Math.round(performance.now() - startedAt)),
            "access-control-expose-headers": "x-synth-ms",
          },
        });
      } catch (err) {
        return c.json(
          { error: err instanceof Error ? err.message : String(err), code: "tts_failed" },
          502,
        );
      }
    });

    // desktop stt test: transcribes a captured sample through the configured
    // server layer (builtin sherpa or remote whisper). Body is a wav, or raw
    // pcm16le mono 16k with content-type audio/L16.
    api.post("/voice/stt-test", async (c) => {
      if (!voiceModels.stt)
        return c.json({ error: "stt test unavailable", code: "stt_test_off" }, 503);
      const raw = new Uint8Array(await c.req.arrayBuffer().catch(() => new ArrayBuffer(0)));
      if (raw.byteLength === 0)
        return c.json({ error: "audio required", code: "stt_bad_audio" }, 400);
      const type = (c.req.header("content-type") ?? "").toLowerCase();
      let pcm: Uint8Array;
      if (type.startsWith("audio/l16")) {
        pcm = raw;
      } else {
        try {
          const wav = decodeWav(raw);
          if (wav.bitsPerSample !== 16 || wav.channels !== 1)
            return c.json({ error: "wav must be 16-bit mono", code: "stt_bad_audio" }, 400);
          pcm = resamplePcm16(wav.data, wav.sampleRate, STT_TEST_RATE);
        } catch (err) {
          return c.json(
            { error: err instanceof Error ? err.message : String(err), code: "stt_bad_audio" },
            400,
          );
        }
      }
      if (pcm.byteLength > STT_TEST_MAX_BYTES)
        return c.json({ error: "audio too long", code: "stt_bad_audio" }, 413);
      // never trigger a multi-hundred-MB model pull from a test click
      if (voiceModels.providers.stt === "builtin") {
        const models = await builtinModelsStatus(voiceModels.dataDir);
        if (!models.stt.installed)
          return c.json({ error: "stt model not downloaded yet", code: "stt_model_missing" }, 409);
      }
      const startedAt = performance.now();
      try {
        const text = (
          await voiceModels.stt().transcribePcm(pcm, { signal: c.req.raw.signal })
        ).trim();
        return c.json({ text, ms: Math.round(performance.now() - startedAt) });
      } catch (err) {
        return c.json(
          { error: err instanceof Error ? err.message : String(err), code: "stt_failed" },
          502,
        );
      }
    });

    api.delete("/voice/models", async (c) => {
      await clearBuiltinModels(voiceModels.dataDir);
      return c.json(await status());
    });
  }

  if (opts.testMode) {
    api.route("/test", testRoutes(db));
  }

  return api;
}
