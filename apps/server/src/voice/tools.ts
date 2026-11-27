import { DEFAULT_SESSION_TOOLS, describeWhiteboardSnapshot } from "@di/shared";
import type { SessionContext, UpdateQuestionArgs, VoiceServerMessage } from "@di/shared";
import type { Db } from "../store/db";

export const MAX_TOOL_OUTPUT = 4000;

/** sessions.tools is a JSON record column; absent/unparseable means default. */
export function parseToolsColumn(raw: string | null | undefined): Record<string, string> {
  if (!raw) return { ...DEFAULT_SESSION_TOOLS };
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return Object.keys(parsed).length > 0 ? parsed : { ...DEFAULT_SESSION_TOOLS };
  } catch {
    return { ...DEFAULT_SESSION_TOOLS };
  }
}

function truncate(text: string, max = MAX_TOOL_OUTPUT): string {
  return text.length <= max ? text : `${text.slice(0, max)}… [truncated]`;
}

export interface ToolExecutorDeps {
  sessionId: string;
  db: Db;
  send: (msg: VoiceServerMessage) => void;
  postEvent: (sessionId: string, type: string, payload?: unknown) => Promise<void>;
  /** Live session context; update_question mutates it. */
  getCtx: () => SessionContext;
  /** Truncation budget for tool results fed to the llm (config.voice.max_tool_output). */
  maxToolOutput: number;
}

/** Executes the voice toolset (update_question, read_<id>, update_<id>) against the session. */
export class ToolExecutor {
  constructor(private readonly deps: ToolExecutorDeps) {}

  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const { sessionId, db, send, postEvent } = this.deps;
    if (name === "update_question") {
      const q = args as unknown as UpdateQuestionArgs;
      const ctx = this.deps.getCtx();
      ctx.currentQuestion = q.question;
      if (q.hints) ctx.hints = q.hints;
      await postEvent(sessionId, "question.updated", {
        question: q.question,
        hints: q.hints ?? [],
      });
      send({ t: "question", question: q.question, hints: q.hints ?? [] });
      return JSON.stringify({ ok: true, question: q.question });
    }
    if (name.startsWith("read_")) {
      const tool = name.slice(5);
      const state = await this.readToolState();
      const content = state[tool] ?? "";
      await postEvent(sessionId, `tool.${name}`, { length: content.length });
      const text = tool === "whiteboard" ? describeWhiteboardSnapshot(content) : content;
      return JSON.stringify({ text: truncate(text, this.deps.maxToolOutput) });
    }
    if (name.startsWith("update_")) {
      const tool = name.slice(7);
      const text = typeof args.text === "string" ? args.text : "";
      await db
        .insertInto("tool_states")
        .values({
          session_id: sessionId,
          tool,
          state: text,
          updated_at: new Date().toISOString(),
        })
        .onConflict((oc) =>
          oc.columns(["session_id", "tool"]).doUpdateSet({
            state: text,
            updated_at: new Date().toISOString(),
          }),
        )
        .execute();
      await postEvent(sessionId, `tool.${name}`, { length: text.length });
      return JSON.stringify({ ok: true, tool });
    }
    return JSON.stringify({ error: `unknown tool: ${name}` });
  }

  private async readToolState(): Promise<Record<string, string>> {
    const rows = await this.deps.db
      .selectFrom("tool_states")
      .select(["tool", "state"])
      .where("session_id", "=", this.deps.sessionId)
      .execute();
    const state: Record<string, string> = {};
    for (const r of rows) state[r.tool] = r.state;
    return state;
  }
}
