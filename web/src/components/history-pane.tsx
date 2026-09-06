import { FormattedMessage, useIntl } from "react-intl";
import { Link } from "@tanstack/react-router";
import * as React from "react";

import { withLocale, useLocale } from "../lib/locale-href";
import { listClientSessions } from "../lib/opfs-store";
import type { Session } from "@di/shared/session";

/**
 * Cached-session list pane. This is user data, not configuration: it reads
 * OPFS client sessions and links to their per-session routes.
 */
export function HistoryPane() {
  const locale = useLocale();
  const intl = useIntl();
  const [sessions, setSessions] = React.useState<Session[] | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    listClientSessions()
      .then((all) => {
        if (cancelled) return;
        all.sort((a, b) => b.created_at.localeCompare(a.created_at));
        setSessions(all);
      })
      .catch(() => {
        if (!cancelled) setSessions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function target(s: Session): string {
    if (s.status === "reported") return withLocale(locale, `/report/${s.id}`);
    if (s.status === "finished") return withLocale(locale, `/finish/${s.id}`);
    return withLocale(locale, `/interview/${s.id}`);
  }

  function relative(iso: string): string {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    if (days < 1) return intl.formatMessage({ id: "history.today" });
    if (days === 1) return intl.formatMessage({ id: "history.yesterday" });
    if (days < 7) return intl.formatMessage({ id: "history.daysAgo" }, { n: days });
    return intl.formatMessage({ id: "history.weeksAgo" }, { n: Math.floor(days / 7) });
  }

  if (sessions === null) {
    return <p className="text-sm text-muted-foreground">…</p>;
  }
  if (sessions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        <FormattedMessage id="history.empty" />
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {sessions.map((s) => (
        <Link
          key={s.id}
          to={target(s)}
          className="flex items-center justify-between rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-muted/60"
        >
          <span className="min-w-0">
            <span className="block truncate font-medium">{s.title}</span>
            <span className="block text-xs text-muted-foreground">
              {s.status} · {relative(s.created_at)}
            </span>
          </span>
          <span
            className={
              "ml-3 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
              (s.status === "reported"
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                : "bg-muted text-muted-foreground")
            }
          >
            {s.status}
          </span>
        </Link>
      ))}
    </div>
  );
}
