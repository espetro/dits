import { describe, expect, it } from "vitest";
import { generateReport } from "./generate";
import type { ReportLlm } from "./generate";
import type { LlmMessage, LlmResult } from "../voice/llm";

const sessionId = "075a126f-5808-4781-b4a8-caf1fba16b5b";
const ctx = {
  sessionId,
  title: "demo",
  mode: "interview",
  turns: [],
};

function reportJson() {
  return JSON.stringify({
    session_id: sessionId,
    overall_score: 7,
    coverage_pct: 50,
    competencies: [],
    model_answers: [],
    generated_at: "2026-09-25T00:00:00.000Z",
  });
}

describe("generateReport", () => {
  it("prefers streamChat and calls it bound (class methods keep this)", async () => {
    class BoundLlm implements ReportLlm {
      private readonly content = reportJson();
      async chat(_messages: LlmMessage[]): Promise<LlmResult> {
        throw new Error("chat must not be used when streamChat exists");
      }
      async streamChat(): Promise<LlmResult> {
        return { content: this.content, toolCalls: [] };
      }
    }
    const report = await generateReport(new BoundLlm(), ctx);
    expect(report.session_id).toBe(sessionId);
    expect(report.overall_score).toBe(7);
  });

  it("falls back to chat when streamChat is absent", async () => {
    const llm: ReportLlm = {
      chat: async () => ({ content: reportJson(), toolCalls: [] }),
    };
    const report = await generateReport(llm, ctx);
    expect(report.overall_score).toBe(7);
  });
});
