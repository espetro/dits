import * as React from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Keyboard } from "lucide-react";

/**
 * QuestionCard (p3-20): `QUESTION n` progress chip + agent-editable
 * question text + hints. n counts update_question tool calls (and
 * question-replacing agent turns under the text fallback) this session.
 */
export function QuestionCard({
  n,
  text,
  hints,
  showTypeHint,
  onType,
}: {
  n: number;
  text: string;
  hints: string[];
  showTypeHint: boolean;
  onType: () => void;
}) {
  const intl = useIntl();
  return (
    <section className="rounded-card bg-paper p-2 ring-1 ring-hairline">
      <div className="rounded-[calc(1.5rem-0.375rem)] bg-persimmon-faint p-5 md:p-6">
        <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-persimmon-deep">
          {n > 0 ? (
            <FormattedMessage id="interview.questionN" values={{ n }} />
          ) : (
            <FormattedMessage id="interview.question" />
          )}
        </p>
        <p
          key={text}
          className="rise-in mt-2 font-display text-lg font-semibold leading-snug md:text-2xl"
        >
          {text || intl.formatMessage({ id: "interview.preparing" })}
        </p>
        {hints.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {hints.map((h, i) => (
              <li
                key={h}
                style={{ "--rise-delay": `${i * 80}ms` } as React.CSSProperties}
                className="rise-in rounded-full bg-white px-3 py-1 text-xs text-espresso-soft ring-1 ring-hairline"
              >
                {h}
              </li>
            ))}
          </ul>
        )}
        {showTypeHint && (
          <button
            onClick={onType}
            className="rise-in mt-3 inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-medium text-espresso ring-1 ring-hairline transition-colors hover:ring-persimmon/50"
          >
            <Keyboard className="size-4 text-espresso-soft" aria-hidden="true" />
            <FormattedMessage id="interview.noSpeechDetected" />
          </button>
        )}
      </div>
    </section>
  );
}
