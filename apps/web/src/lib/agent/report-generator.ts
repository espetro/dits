import { toJsonSchema } from "@valibot/to-json-schema";
import { ReportSchema, buildReportPrompt } from "@di/shared/report";
import type { Report, ReportPromptContext } from "@di/shared/report";
import type { LlmSection } from "@di/shared";
import { createLlmModel } from "./browser-provider";

/**
 * Client-only report generation: one generateObject call against the BYO
 * provider (remote endpoint or in-browser engine), scored straight into
 * ReportSchema so it round-trips through the same OPFS record (and the same
 * UI) a server-generated report would use. Pass `options.signal` to bound
 * the call (the report route uses a 90s AbortSignal.timeout so a stalled
 * provider surfaces as an error, not a spinner that spins forever).
 *
 * Strict schema validation with one retry: small in-browser models
 * occasionally emit malformed JSON, so a single failed attempt is retried
 * before surfacing an error to the report route.
 */
export async function generateReport(
  llm: LlmSection,
  ctx: ReportPromptContext,
  fetchImpl?: typeof fetch,
  options?: { signal?: AbortSignal },
): Promise<Report> {
  const { generateObject, jsonSchema } = await import("ai");
  const built = createLlmModel(llm, { fetchImpl });
  if (!built) throw new Error("in-browser llm engine unsupported in this browser");
  const schema = jsonSchema(toJsonSchema(ReportSchema));
  const prompt = buildReportPrompt(ctx);
  try {
    const { object } = await generateObject({
      model: built.model,
      abortSignal: options?.signal,
      schema,
      prompt,
    });
    return object as Report;
  } catch (first) {
    if (options?.signal?.aborted) throw first;
    const { object } = await generateObject({
      model: built.model,
      abortSignal: options?.signal,
      schema,
      prompt,
    });
    return object as Report;
  }
}
