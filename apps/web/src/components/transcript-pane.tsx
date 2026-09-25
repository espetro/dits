import * as React from "react";
import { useIntl } from "react-intl";
import { Input } from "./vendor/input";
import type { TurnDto } from "../lib/api";

/**
 * Transcript turn list + the first-class "talk or type…" input (p3-22).
 * Shared by the desktop rail and the mobile bottom Sheet. Typed turns go
 * through the same agent pipeline as speech — this is not a fallback.
 */
export function TranscriptPane({
  turns,
  text,
  onTextChange,
  onSend,
  inputRef,
}: {
  turns: Pick<TurnDto, "id" | "speaker" | "source" | "text">[] | undefined;
  text: string;
  onTextChange: (value: string) => void;
  onSend: () => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const intl = useIntl();
  return (
    <>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-3">
        {(turns ?? []).map((t) => (
          <div
            key={t.id}
            className={`rise-in rounded-2xl px-3 py-2 text-sm ${t.speaker === "agent" ? "bg-persimmon-faint" : "bg-white/70"}`}
          >
            <span className="block text-[10px] uppercase tracking-wider text-espresso-soft">
              {t.speaker} · {t.source}
            </span>
            {t.text}
          </div>
        ))}
      </div>
      <div className="p-3">
        <Input
          ref={inputRef}
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSend()}
          placeholder={intl.formatMessage({ id: "interview.talkOrType" })}
          aria-label={intl.formatMessage({ id: "interview.talkOrType" })}
          className="h-11 rounded-full border-0 bg-white px-4 text-sm ring-1 ring-hairline shadow-none transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] placeholder:text-espresso-soft focus-visible:ring-2 focus-visible:ring-persimmon/50"
        />
      </div>
    </>
  );
}
