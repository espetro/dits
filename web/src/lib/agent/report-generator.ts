import { toJsonSchema } from "@valibot/to-json-schema";
import { ReportSchema, buildReportPrompt } from "@di/shared/report";
import type { Report, ReportPromptContext } from "@di/shared/report";
import type { ProviderEndpoint } from "@di/shared";
import { createOpenAiCompatibleModel } from "./openai-compatible-provider";

/**
 * Client-only report generation: one generateObject call against the BYO
 * provider, scored straight into ReportSchema so it round-trips through the
 * same OPFS record (and the same UI) a server-generated report would use.
 * Pass `options.signal` to bound the call (the report route uses a 90s
 * AbortSignal.timeout so a stalled provider surfaces as an error, not a
 * spinner that spins forever).
 */
export async function generateReport(
  llm: ProviderEndpoint,
  ctx: ReportPromptContext,
  fetchImpl?: typeof fetch,
  options?: { signal?: AbortSignal },
): Promise<Report> {
  const { generateObject, jsonSchema } = await import("ai");
  const model = createOpenAiCompatibleModel(llm, { fetchImpl });
  const { object } = await generateObject({
    model,
    abortSignal: options?.signal,
    schema: jsonSchema(toJsonSchema(ReportSchema)),
    prompt: buildReportPrompt(ctx),
  });
  return object as Report;
}
