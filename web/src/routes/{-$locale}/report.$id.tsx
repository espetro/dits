import { createFileRoute, Link } from "@tanstack/react-router";
import { useLocale, withLocale } from "../../lib/locale-href";
import { FormattedMessage, useIntl } from "react-intl";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@nanostores/react";
import { getReport, getSession } from "../../lib/api";
import { $effectiveRuntime, $providerProfile } from "../../lib/runtime";
import {
  getClientReport,
  getClientSession,
  getClientTurns,
  saveClientReport,
} from "../../lib/opfs-store";
import { generateReport } from "../../lib/agent/report-generator";
import { Button } from "../../components/vendor/button";
import { Badge } from "../../components/vendor/badge";

export const Route = createFileRoute("/{-$locale}/report/$id")({
  component: Report,
});

interface ReportDto {
  overall_score: number;
  coverage_pct: number;
  competencies: Array<{
    name: string;
    score: number;
    evidence: Array<{ quote: string; turn_seq: number; verdict: string }>;
  }>;
}

const VERDICT_TONE: Record<string, string> = {
  worked: "bg-sage/15 text-sage",
  improve: "bg-butter/20 text-[#9a7d1a]",
  drop: "bg-persimmon-soft text-persimmon-deep",
};

async function loadOrGenerateClientReport(id: string): Promise<ReportDto> {
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
  return report;
}

function Report() {
  const intl = useIntl();
  const { id } = Route.useParams();
  const locale = useLocale();
  const effectiveRuntime = useStore($effectiveRuntime);
  const clientOnly = effectiveRuntime !== "server";
  const { data: serverSession } = useQuery({
    queryKey: ["session", id],
    queryFn: () => getSession(id),
    enabled: !clientOnly,
  });
  const { data: clientSession } = useQuery({
    queryKey: ["client-session", id],
    queryFn: () => getClientSession(id),
    enabled: clientOnly,
  });
  const session = clientOnly ? clientSession : serverSession;
  const {
    data: report,
    isLoading,
    isError,
    refetch,
  } = useQuery<ReportDto>({
    queryKey: ["report", id, clientOnly],
    queryFn: () =>
      clientOnly ? loadOrGenerateClientReport(id) : (getReport(id) as Promise<ReportDto>),
    retry: 2,
    retryDelay: 1500,
  });
  const [slowLoad, setSlowLoad] = React.useState(false);
  React.useEffect(() => {
    if (!isLoading) {
      setSlowLoad(false);
      return;
    }
    const t = setTimeout(() => setSlowLoad(true), 15_000);
    return () => clearTimeout(t);
  }, [isLoading]);

  if (isLoading) {
    return (
      <div className="ambient grain flex min-h-[100dvh] items-center justify-center bg-cream">
        <div className="text-center">
          <div
            className="orb-live mx-auto h-10 w-10 rounded-full bg-gradient-to-br from-persimmon to-persimmon-deep"
            aria-hidden="true"
          />
          <p className="rise-in mt-6 font-display text-lg text-espresso-soft">
            <FormattedMessage id="report.scoring" />
          </p>
          {slowLoad ? (
            <p className="mt-2 text-sm text-espresso-soft">
              <FormattedMessage id="report.scoringSlow" />
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  if (isError || !report) {
    return (
      <div className="ambient grain flex min-h-[100dvh] items-center justify-center bg-cream">
        <main className="rise-in w-full max-w-md text-center">
          <p className="text-[10px] uppercase tracking-[0.2em] font-medium text-espresso-soft">
            <FormattedMessage id="report.noReportYet" />
          </p>
          <h1 className="mt-3 font-display text-2xl font-extrabold tracking-tight">
            <FormattedMessage id="report.failed" />
          </h1>
          <p className="mt-3 text-sm text-espresso-soft">
            <FormattedMessage id="report.failedBody" />
          </p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <Button
              variant="outline"
              onClick={() => void refetch()}
              className="rounded-full bg-white px-6 py-3 h-auto ring-hairline duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:ring-persimmon/50 active:scale-[0.97]"
            >
              <FormattedMessage id="report.tryAgain" />
            </Button>
            <Link
              to={withLocale(locale, `/finish/${id}`)}
              className="text-sm text-espresso-soft underline decoration-hairline underline-offset-4 transition-fluid hover:text-persimmon"
            >
              <FormattedMessage id="report.backToTranscript" />
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="ambient grain min-h-[100dvh] bg-cream">
      <main className="mx-auto w-full max-w-4xl px-4 pb-24 pt-10 md:px-8">
        {/* score bento */}
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rise-in rounded-card bg-espresso p-6 text-cream">
            <p className="text-[10px] uppercase tracking-[0.2em] text-cream/60">
              <FormattedMessage id="report.overall" />
            </p>
            <p className="mt-2 font-display text-5xl font-extrabold tabular-nums">
              {report.overall_score}
              <span className="text-xl text-cream/60"> /10</span>
            </p>
          </div>
          <div
            className="rise-in rounded-card bg-paper p-6 ring-1 ring-hairline"
            style={{ "--rise-delay": "120ms" } as React.CSSProperties}
          >
            <p className="text-[10px] uppercase tracking-[0.2em] font-medium text-espresso-soft">
              <FormattedMessage id="report.coverage" />
            </p>
            <p className="mt-2 font-display text-5xl font-extrabold">
              {report.coverage_pct}
              <span className="text-xl text-espresso-soft">%</span>
            </p>
          </div>
          <div
            className="rise-in rounded-card bg-persimmon-faint p-6"
            style={{ "--rise-delay": "240ms" } as React.CSSProperties}
          >
            <p className="text-[10px] uppercase tracking-[0.2em] font-medium text-persimmon-deep">
              <FormattedMessage id="report.session" />
            </p>
            <p className="mt-2 font-display text-xl font-bold">
              {session?.mode} · {session?.duration_min} min
            </p>
          </div>
        </div>

        {/* competencies */}
        <h2 className="mt-12 text-[10px] uppercase tracking-[0.2em] font-medium text-espresso-soft">
          <FormattedMessage id="report.competencies" />
        </h2>
        <div className="mt-4 space-y-4">
          {report.competencies.map((c, i) => (
            <div
              key={c.name}
              className="rise-in rounded-card bg-paper p-2 ring-1 ring-hairline"
              style={
                {
                  "--rise-delay": `${Math.min(i * 90, 450)}ms`,
                } as React.CSSProperties
              }
            >
              <div className="rounded-[calc(1.5rem-0.375rem)] bg-cream p-5">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <span className="font-display font-semibold">{c.name}</span>
                  <span className="font-display text-lg font-bold text-persimmon">
                    {c.score.toFixed(1)}
                  </span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-cream-deep">
                  <div
                    className="h-2 rounded-full bg-persimmon transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]"
                    style={{ width: `${c.score * 10}%` }}
                  />
                </div>
                <ul className="mt-4 space-y-2">
                  {c.evidence.map((e, ei) => (
                    <li key={ei} className="flex flex-wrap items-baseline gap-2 text-sm">
                      <Badge
                        variant="ghost"
                        className={`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${VERDICT_TONE[e.verdict] ?? ""}`}
                      >
                        {e.verdict}
                      </Badge>
                      <span className="text-espresso-soft">“{e.quote}”</span>
                      <span className="text-xs text-espresso-soft">
                        <FormattedMessage id="report.turn" values={{ n: e.turn_seq }} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-12 flex justify-center">
          <Button
            disabled
            title={intl.formatMessage({ id: "report.practiceHint" })}
            aria-disabled
            className="group max-w-full rounded-full bg-white/60 px-7 py-3.5 h-auto font-display font-semibold text-espresso-soft ring-1 ring-hairline animate-pulse"
          >
            <FormattedMessage id="report.practiceWeak" />
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-espresso/5">
              →
            </span>
          </Button>
        </div>
      </main>
    </div>
  );
}
