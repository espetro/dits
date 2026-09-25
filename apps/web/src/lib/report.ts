import { requestReport } from "./api";
import type { ReportDto } from "./api";
import { $providerProfile } from "./runtime";
import {
  getClientReport,
  getClientSession,
  getClientTurns,
  saveClientReport,
  setClientSessionStatus,
} from "./opfs-store";
import { generateReport } from "./agent/report-generator";

export type { ReportDto };

/**
 * Client-only report, cached first: an already-generated OPFS report is
 * returned unchanged (same idempotence as the server POST). Generation
 * needs a configured llm section — without it the caller lands in the
 * failure state, not a spinner.
 */
export async function ensureClientReport(id: string): Promise<ReportDto> {
  const cached = await getClientReport(id);
  if (cached) return cached;
  const profile = $providerProfile.get();
  const session = await getClientSession(id);
  if (!profile?.llm || !session) throw new Error("no provider profile or session");
  const turns = await getClientTurns(id);
  const report = await generateReport(
    profile.llm,
    {
      sessionId: id,
      title: session.title,
      mode: session.mode,
      turns,
    },
    undefined,
    { signal: AbortSignal.timeout(90_000) },
  );
  await saveClientReport(id, report);
  await setClientSessionStatus(id, "reported");
  return report;
}

/** One report-build entry point per runtime (p3 finish auto-advance). */
export function ensureReport(id: string, clientOnly: boolean): Promise<ReportDto> {
  return clientOnly ? ensureClientReport(id) : requestReport(id);
}
