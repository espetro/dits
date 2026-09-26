import * as v from "valibot";
import { ReportSchema, buildReportPrompt } from "@di/shared/report";
import type { Report, ReportPromptContext } from "@di/shared";
import type { LlmMessage, LlmResult } from "../voice/llm";

/**
 * Narrow port for report generation. `streamChat` is preferred: some
 * OpenAI-compatible gateways only support streaming; `chat` is the fallback.
 */
export interface ReportLlm {
  chat(messages: LlmMessage[]): Promise<LlmResult>;
  streamChat?(messages: LlmMessage[]): Promise<LlmResult>;
}

const PARSE_RETRY_HINT =
  "\n\nYour previous reply was not valid JSON for the required schema. Reply with ONLY the JSON object, no markdown fences, no commentary.";

/**
 * Server-side report generator: same shared prompt and schema as the
 * browser's report-generator, driven through the loop's VoiceLlm port instead
 * of the ai SDK. One retry on malformed output, then throw.
 */
export async function generateReport(llm: ReportLlm, ctx: ReportPromptContext): Promise<Report> {
  const base = buildReportPrompt(ctx);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = attempt === 0 ? base : base + PARSE_RETRY_HINT;
    try {
      const messages: LlmMessage[] = [{ role: "user", content: prompt }];
      const result = llm.streamChat ? await llm.streamChat(messages) : await llm.chat(messages);
      const raw = extractJson(result.content);
      // Server-owned fields: overwrite unconditionally — the model echoes
      // wrong values (e.g. a canned timestamp) as often as it omits them.
      if (raw !== null && typeof raw === "object") {
        const r = raw as Record<string, unknown>;
        r.session_id = ctx.sessionId;
        r.generated_at = new Date().toISOString();
      }
      return v.parse(ReportSchema, raw);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/** Pull the first {...} JSON object out of a reply (fences/thinking stripped). */
export function extractJson(content: string): unknown {
  const stripped = content.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(?:json)?/g, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("llm reply contained no JSON object");
  return JSON.parse(stripped.slice(start, end + 1));
}
