import { FormattedMessage } from "react-intl";
import { Keyboard } from "lucide-react";

/**
 * QuestionChip row: `QUESTION n` progress chip at the top of the
 * conversation card (n counts update_question calls this session), plus
 * optional hint chips the agent attached, plus the type-instead affordance
 * when no speech has been detected yet.
 */
export function QuestionCard({
  n,
  hints,
  showTypeHint,
  onType,
}: {
  n: number;
  hints: string[];
  showTypeHint: boolean;
  onType: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center rounded-full bg-persimmon-faint px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-persimmon-deep">
        {n > 0 ? (
          <FormattedMessage id="interview.questionN" values={{ n }} />
        ) : (
          <FormattedMessage id="interview.question" />
        )}
      </span>
      {hints.map((h) => (
        <span
          key={h}
          className="inline-flex items-center rounded-full bg-paper px-2.5 py-1 text-[11px] text-espresso-soft ring-1 ring-hairline"
        >
          {h}
        </span>
      ))}
      {showTypeHint && (
        <button
          onClick={onType}
          className="rise-in inline-flex min-h-8 items-center gap-1.5 rounded-full bg-paper px-3 text-xs font-medium text-espresso ring-1 ring-hairline transition-colors hover:ring-persimmon/50"
        >
          <Keyboard className="size-3.5 text-espresso-soft" aria-hidden="true" />
          <FormattedMessage id="interview.noSpeechDetected" />
        </button>
      )}
    </div>
  );
}
