import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useLocale, withLocale } from "../../lib/locale-href";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@nanostores/react";
import { FormattedMessage } from "react-intl";
import { getSession, getTurns } from "../../lib/api";
import type { TurnDto } from "../../lib/api";
import { $effectiveRuntime } from "../../lib/runtime";
import { getClientSession, getClientTurns } from "../../lib/opfs-store";
import { openSettings } from "../../components/settings-dialog";
import { Button } from "../../components/vendor/button";

function formatTimestamp(createdAt: string) {
  const d = new Date(createdAt);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function transcriptToMarkdown(session: { title: string }, turns: TurnDto[]) {
  const lines = turns.map(
    (t) => `**${t.speaker}** (${t.source}, ${formatTimestamp(t.created_at)}): ${t.text}`,
  );
  return `# ${session.title}\n\n${lines.join("\n\n")}\n`;
}

function download(filename: string, blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export const Route = createFileRoute("/{-$locale}/finish/$id")({
  component: Finish,
});

function Finish() {
  const { id } = Route.useParams();
  const locale = useLocale();
  const navigate = useNavigate();
  const effectiveRuntime = useStore($effectiveRuntime);
  const clientOnly = effectiveRuntime !== "server";
  const { data: serverSession } = useQuery({
    queryKey: ["session", id],
    queryFn: () => getSession(id),
    enabled: !clientOnly,
  });
  const { data: serverTurns } = useQuery({
    queryKey: ["turns", id],
    queryFn: () => getTurns(id),
    enabled: !clientOnly,
  });
  const { data: clientSession } = useQuery({
    queryKey: ["client-session", id],
    queryFn: () => getClientSession(id),
    enabled: clientOnly,
  });
  const { data: clientTurns } = useQuery({
    queryKey: ["client-turns", id],
    queryFn: () => getClientTurns(id),
    enabled: clientOnly,
  });
  const session = clientOnly ? clientSession : serverSession;
  const turns = clientOnly ? clientTurns : serverTurns;

  function downloadMarkdown() {
    if (!session) return;
    download(
      `transcript-${id}.md`,
      new Blob([transcriptToMarkdown(session, turns ?? [])], {
        type: "text/markdown",
      }),
    );
  }

  function downloadJson() {
    setMenuOpen(false);
    download(
      `transcript-${id}.json`,
      new Blob([JSON.stringify(turns ?? [], null, 2)], {
        type: "application/json",
      }),
    );
  }

  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  return (
    <div className="ambient grain flex min-h-[100dvh] items-center justify-center bg-cream px-4 py-16 lg:py-32">
      <main className="w-full max-w-md text-center">
        <div className="rise-in">
          <p className="text-[10px] uppercase tracking-[0.2em] font-medium text-espresso-soft">
            <FormattedMessage id="finish.complete" />
          </p>
          <h1 className="mt-3 break-words font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
            {session?.title ?? "session"}
          </h1>
          <p className="mt-2 text-sm text-espresso-soft">
            <FormattedMessage
              id="finish.summary"
              values={{
                duration: session?.duration_min ?? 0,
                turns: turns?.length ?? 0,
              }}
            />
          </p>
        </div>

        <div className="mt-10 space-y-3">
          <div
            ref={menuRef}
            className="rise-in relative"
            style={{ "--rise-delay": "200ms" } as React.CSSProperties}
          >
            <Button
              variant="outline"
              onClick={downloadMarkdown}
              className="w-full rounded-full bg-white px-6 py-3.5 h-auto font-display ring-hairline duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:ring-persimmon/50 active:scale-[0.98]"
            >
              <FormattedMessage id="finish.getTranscript" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="more transcript formats"
              aria-expanded={menuOpen}
              className="absolute right-1.5 top-1.5 h-[calc(100%-0.75rem)] w-10 rounded-full text-espresso-soft duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-cream-deep"
            >
              <svg viewBox="0 0 12 8" className="h-2 w-3 fill-current">
                <path d="M0 0h12L6 8z" />
              </svg>
            </Button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-10 mt-2 w-48 rounded-2xl bg-white p-1 shadow-lg ring-1 ring-hairline">
                <Button
                  variant="ghost"
                  onClick={downloadJson}
                  className="w-full justify-start rounded-xl px-4 py-2.5 text-left text-sm text-espresso duration-300 hover:bg-cream-deep"
                >
                  <FormattedMessage id="finish.downloadJson" />
                </Button>
              </div>
            )}
          </div>
          <Button
            style={{ "--rise-delay": "350ms" } as React.CSSProperties}
            className="rise-in group w-full rounded-full bg-espresso px-6 py-3.5 h-auto font-display font-semibold text-cream duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-persimmon active:scale-[0.98]"
            onClick={() => navigate({ href: withLocale(locale, `/report/${id}`) })}
          >
            <FormattedMessage id="finish.generateReport" />
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-cream/15 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-1 group-hover:scale-105">
              →
            </span>
          </Button>
          <Button
            variant="link"
            onClick={() => openSettings("history")}
            className="h-auto text-sm text-espresso-soft underline decoration-hairline underline-offset-4 transition-fluid hover:text-persimmon"
          >
            <FormattedMessage id="finish.discard" />
          </Button>
        </div>
      </main>
    </div>
  );
}
