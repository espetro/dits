import { Link } from "@tanstack/react-router";
import { FormattedMessage } from "react-intl";
import type { ReactNode } from "react";

import { useLocale, withLocale } from "../lib/locale-href";

/**
 * CallBar: the 44px in-call bar that replaces AppHeader on /interview/*.
 * di. logo + scenario title on the left, elapsed/total timer centered
 * (hidden on mobile), "end interview" on the right.
 */
export function CallBar({
  title,
  elapsed,
  total,
  wrapping,
  onEnd,
  end,
}: {
  title: string;
  /** elapsed/total already formatted as mm:ss */
  elapsed: string;
  total: string;
  /** wrap-up threshold reached -> persimmon timer */
  wrapping: boolean;
  onEnd: () => void;
  /** trailing slot, e.g. the voice-retry button on error */
  end?: ReactNode;
}) {
  const locale = useLocale();
  return (
    <header className="flex h-11 shrink-0 items-center border-b border-hairline px-3.5 text-xs text-espresso-soft">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <Link
          to={withLocale(locale, "/") as "/{-$locale}"}
          className="font-display text-[15px] font-bold tracking-tight text-espresso transition-fluid active:scale-[0.98]"
        >
          di<span className="text-persimmon">.</span>
        </Link>
        <h1 className="truncate font-semibold text-espresso">{title || "…"}</h1>
      </div>
      <span
        className={`hidden font-mono tabular-nums md:block ${wrapping ? "text-persimmon" : ""}`}
      >
        {elapsed} / {total}
      </span>
      <div className="flex flex-1 items-center justify-end gap-3">
        {end}
        <button
          type="button"
          onClick={onEnd}
          className="font-semibold text-persimmon-deep transition-fluid hover:text-persimmon"
        >
          <FormattedMessage id="interview.endInterview" />
        </button>
      </div>
    </header>
  );
}
