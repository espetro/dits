import * as v from "valibot";
import type { Config } from "@di/shared";
import { VoiceClientMessageSchema } from "@di/shared/voice";
import type { Db } from "../store/db";
import { VoiceLoop } from "./loop";

/** GET /v1/sessions/:id/voice — WebSocket upgrade path. */
export const VOICE_WS_PATH_RE = /^\/v1\/sessions\/([0-9a-f-]{36})\/voice$/;

export type VoiceLoopMessage =
  | v.InferOutput<typeof VoiceClientMessageSchema>
  | { t: "binary"; data: Uint8Array };

export interface VoiceLoopLike {
  start: () => Promise<void>;
  handleMessage: (msg: VoiceLoopMessage) => Promise<void>;
  close: () => void;
}

export interface VoiceDeps {
  config: Config;
  db: Db;
  /** Test injection point for stub STT/TTS/LLM. */
  loopFactory?: (
    sessionId: string,
    send: (msg: unknown) => void,
    sendBinary: (d: Uint8Array) => void,
  ) => VoiceLoopLike;
}

/**
 * Build the Bun.serve websocket handlers for the voice endpoint.
 * serveApp upgrades matching requests before falling through to the Hono app;
 * open/message/close below drive the per-connection VoiceLoop. The loop rides
 * on ws.data so no cross-connection state is shared.
 */
export function voiceWebSocketHandler(deps: VoiceDeps) {
  return {
    async open(ws: Bun.ServerWebSocket<unknown> & { loop?: VoiceLoopLike }) {
      const { sessionId } = ws.data as { sessionId: string };
      const send = (msg: unknown) => ws.send(JSON.stringify(msg));
      const sendBinary = (d: Uint8Array) =>
        "sendBinary" in ws
          ? (ws as { sendBinary: (d: Uint8Array) => void }).sendBinary(d)
          : undefined;
      const loop =
        deps.loopFactory?.(sessionId, send, sendBinary) ??
        new VoiceLoop({
          sessionId,
          config: deps.config,
          db: deps.db,
          send: send as never,
          sendBinary,
        });
      ws.loop = loop;
      try {
        await loop.start();
      } catch (err) {
        console.error(`[voice] loop start failed: ${err}`);
        send({
          t: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    async message(
      ws: Bun.ServerWebSocket<unknown> & { loop?: VoiceLoopLike },
      message: string | Buffer | Uint8Array,
    ) {
      const loop = ws.loop;
      if (!loop) return;
      try {
        if (typeof message !== "string") {
          await loop.handleMessage({
            t: "binary",
            data: new Uint8Array(message),
          });
          return;
        }
        const parsed = v.parse(VoiceClientMessageSchema, JSON.parse(message));
        await loop.handleMessage(parsed);
      } catch (err) {
        console.warn(
          `[voice] bad message on ${(ws.data as { sessionId: string }).sessionId}: ${err}`,
        );
      }
    },
    close(ws: Bun.ServerWebSocket<unknown> & { loop?: VoiceLoopLike }) {
      ws.loop?.close();
    },
  };
}

export interface UpgradeServer {
  upgrade: (req: Request, opts: { data: unknown }) => boolean;
}

/**
 * Handle the voice WS upgrade for a request, or null to fall through to the
 * Hono app. Unknown sessions get a 404 before the upgrade happens.
 */
export async function tryUpgradeVoice(
  req: Request,
  server: UpgradeServer,
  db: Db,
): Promise<Response | null> {
  const url = new URL(req.url);
  const match = VOICE_WS_PATH_RE.exec(url.pathname);
  if (!match) return null;
  const sessionId = match[1]!;
  const session = await db
    .selectFrom("sessions")
    .select("id")
    .where("id", "=", sessionId)
    .executeTakeFirst();
  if (!session) return Response.json({ error: "session not found" }, { status: 404 });
  if (server.upgrade(req, { data: { sessionId } })) return null;
  return new Response("websocket upgrade failed", { status: 400 });
}
