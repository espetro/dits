import { readFileSync } from "node:fs";
import { Hono } from "hono";
import type { Config } from "@di/shared";
import type { Db } from "../store/db";
import { apiRoutes } from "./routes";
import type { TtsTestPort } from "./routes";
import { sttProviderOf, ttsProviderOf } from "../voice/providers";
import { createTtsFromConfig } from "../voice/tts";
import { createLlmFromConfig } from "../voice/llm";
import { embeddingsClientFromConfig } from "../rag/ingest";
import { tryUpgradeVoice, voiceWebSocketHandler } from "../voice/ws";
import type { VoiceDeps } from "../voice/ws";

export interface AppDeps {
  config: Config;
  db: Db;
  testMode: boolean;
  /** Embedded web UI assets; omitted in dev when apps/web/ is served separately. */
  webAssets?: { root: string; path: string };
  /** Test injection for the voice WS loop (stub STT/TTS/LLM). */
  voiceDeps?: Pick<VoiceDeps, "loopFactory"> & { ttsTest?: () => TtsTestPort };
}

export async function createApp(deps: AppDeps): Promise<Hono> {
  const app = new Hono();
  let ttsTest: TtsTestPort | undefined;

  // Dev CORS: when the SPA runs under a vite dev server (different origin
  // from this API), the health probe and driver fetches are cross-origin.
  // The production binary serves the SPA itself, same origin, so the browser
  // never sees these headers there.
  app.use("*", async (c, next) => {
    if (c.req.method === "OPTIONS") {
      c.header("access-control-allow-origin", c.req.header("origin") ?? "*");
      c.header("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      c.header("access-control-allow-headers", "content-type, authorization");
      return c.body(null, 204);
    }
    await next();
    if (c.req.header("origin")) {
      c.header("access-control-allow-origin", c.req.header("origin")!);
      c.header("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      c.header("access-control-allow-headers", "content-type, authorization");
    }
  });

  app.route(
    "/v1",
    apiRoutes(deps.db, {
      testMode: deps.testMode,
      embeddings: embeddingsClientFromConfig(deps.config.embeddings),
      documents: deps.config.documents,
      logPath: deps.config.files.log_path,
      voiceModels: {
        providers: {
          stt: sttProviderOf(deps.config.stt),
          tts: ttsProviderOf(deps.config.tts),
        },
        dataDir: deps.config.files.data_dir,
        tts: deps.voiceDeps?.ttsTest ?? (() => (ttsTest ??= createTtsFromConfig(deps.config))),
      },
      reportLlm: createLlmFromConfig(deps.config.llm),
    }),
  );

  app.get("/v1/openapi.json", (c) => c.json(openApiSpec(deps.config)));

  app.get("/api/health", (c) => c.json({ ok: true, testMode: deps.testMode }));

  if (deps.webAssets) {
    const { serveStatic } = await import("@hono/node-server/serve-static");
    app.use(
      "*",
      serveStatic({
        root: deps.webAssets.root,
        rewriteRequestPath: (p) => (p === "/" ? "/index.html" : p),
      }),
    );
    // SPA fallback: any non-API GET serves the shell so deep links work.
    app.get("*", (c) => {
      const url = new URL(c.req.url);
      if (url.pathname.startsWith("/v1") || url.pathname.startsWith("/api")) return c.notFound();
      return c.html(readFileSync(`${deps.webAssets!.root}/index.html`, "utf8"));
    });
  }

  app.notFound((c) => c.json({ error: "not found", code: "not_found" }, 404));

  return app;
}

function openApiSpec(config: Config): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: { title: "di API", version: "0.1.0" },
    servers: [{ url: `http://localhost:${config.server.port}` }],
    paths: {
      "/v1/sessions": {
        post: {
          summary: "Create an interview session",
          responses: { "201": { description: "Created" } },
        },
        get: {
          summary: "List sessions",
          responses: { "200": { description: "OK" } },
        },
      },
      "/v1/sessions/{id}": {
        get: {
          summary: "Get a session",
          responses: {
            "200": { description: "OK" },
            "404": { description: "Not found" },
          },
        },
      },
      "/v1/sessions/{id}/turns": {
        post: {
          summary: "Append a transcript turn",
          responses: { "201": { description: "Created" } },
        },
        get: {
          summary: "List turns",
          responses: { "200": { description: "OK" } },
        },
      },
      "/v1/sessions/{id}/events": {
        post: {
          summary: "Append a session event",
          responses: { "201": { description: "Created" } },
        },
      },
      "/v1/sessions/{id}/report": {
        post: {
          summary: "Generate the report via the configured LLM (idempotent)",
          responses: {
            "201": { description: "Generated" },
            "200": { description: "Existing report returned" },
            "404": { description: "Session not found" },
            "502": { description: "Generation failed" },
            "503": { description: "No report LLM configured" },
          },
        },
        put: {
          summary: "Store the report",
          responses: { "200": { description: "OK" } },
        },
        get: {
          summary: "Get the report",
          responses: {
            "200": { description: "OK" },
            "404": { description: "Not found" },
          },
        },
      },
      "/v1/relay": {
        post: {
          summary: "Relay a provider call (browser-mode provider bridge)",
          responses: {
            "200": { description: "Upstream response streamed through" },
            "400": { description: "Invalid or missing url query parameter" },
            "502": { description: "Upstream fetch failed" },
          },
        },
        get: {
          summary: "Relay a provider GET (e.g. /v1/models probe; browser-mode provider bridge)",
          responses: {
            "200": { description: "Upstream response streamed through" },
            "400": { description: "Invalid or missing url query parameter" },
            "502": { description: "Upstream fetch failed" },
          },
        },
      },
      "/v1/voice/models": {
        get: {
          summary: "Builtin voice model cache status",
          responses: { "200": { description: "OK" } },
        },
        delete: {
          summary: "Clear the builtin voice model cache",
          responses: { "200": { description: "OK" } },
        },
      },
      "/v1/voice/models/pull": {
        post: {
          summary: "Download builtin voice models (sha256-verified, idempotent)",
          responses: {
            "200": { description: "OK" },
            "400": { description: "No builtin providers configured" },
          },
        },
      },
    },
  };
}

/**
 * Serve the app on Bun with the voice WebSocket endpoint. Bun does not speak
 * Hono's upgradeWebSocket adapter, so /v1/sessions/:id/voice is upgraded
 * directly via server.upgrade() before falling through to app.fetch.
 */
export function serveApp(
  app: Hono,
  port: number,
  deps: { config: Config; db: Db; voiceDeps?: Pick<VoiceDeps, "loopFactory"> },
): ReturnType<typeof Bun.serve> {
  const ws = voiceWebSocketHandler({
    config: deps.config,
    db: deps.db,
    loopFactory: deps.voiceDeps?.loopFactory,
  });
  return Bun.serve({
    port,
    // LLM-backed routes (e.g. report generation) can take minutes against
    // reasoning models; the default 10s idle kills them mid-request.
    idleTimeout: 255,
    websocket: ws as never,
    fetch: async (req, server) => {
      const upgraded = await tryUpgradeVoice(req, server as UpgradeServer, deps.db);
      return upgraded ?? app.fetch(req);
    },
  });
}

interface UpgradeServer {
  upgrade: (req: Request, opts: { data: unknown }) => boolean;
}
