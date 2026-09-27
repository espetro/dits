import { Link } from "@tanstack/react-router";
import { AlignLeft, ArrowRight, Mic, X } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import type { ReactNode } from "react";
import { Reveal } from "./reveal";
import { useLocale, withLocale } from "../lib/locale-href";

const IS_PUBLIC_SITE = import.meta.env.VITE_PUBLIC_SITE === "1";

const WAVE_BARS = [11, 18, 13, 20, 9, 16, 19, 11];

interface PeekRow {
  id: string;
  speaker: "agent" | "you";
}

const PEEK_ROWS: readonly PeekRow[] = [
  { id: "landing.peek.line.agent1", speaker: "agent" },
  { id: "landing.peek.line.you1", speaker: "you" },
  { id: "landing.peek.line.agent2", speaker: "agent" },
];

function PeekWave() {
  return (
    <div className="peek-wave flex h-[22px] items-center gap-[2.5px] border-t border-hairline pt-2">
      {WAVE_BARS.map((h, i) => (
        <i key={i} style={{ height: `${h}px`, animationDelay: `${i * 0.08}s` }} />
      ))}
      <span className="ml-auto text-[9px] uppercase tracking-[0.1em] text-espresso-faint">
        <FormattedMessage id="landing.peek.micLabel" />
      </span>
    </div>
  );
}

/**
 * Landing hero + product peek: headerless centered hero (espresso pill,
 * Fraunces-black headline with a persimmon italic emphasis word, one-line sub,
 * single persimmon CTA) above a miniature of the interview screen that runs
 * below the fold by design. The peek is purely presentational (role="img") —
 * static mock content, every string from the locale files.
 */
export function LandingPage() {
  const locale = useLocale();
  const intl = useIntl();
  const cta = (
    <>
      <FormattedMessage id="landing.cta" />
      <span className="grid h-[38px] w-[38px] place-items-center rounded-full bg-cream/[0.18] transition-fluid group-hover:translate-x-0.5">
        <ArrowRight className="h-[15px] w-[15px]" strokeWidth={2.4} aria-hidden="true" />
      </span>
    </>
  );
  const ctaClass =
    "group inline-flex items-center gap-3 rounded-full bg-persimmon py-2 pl-[26px] pr-[10px] text-base font-semibold text-cream shadow-[0_14px_30px_-10px_rgba(255,111,30,0.5)] transition-fluid hover:bg-persimmon-deep active:scale-[0.98]";
  return (
    <div className="ambient grain min-h-[100dvh] bg-cream">
      <main className="relative z-10 mx-auto flex w-full flex-col items-center px-5 pt-12 text-center min-[700px]:pt-[72px]">
        <Reveal>
          <span className="mb-[30px] inline-block rounded-full bg-espresso px-4 py-2 text-[11px] font-bold uppercase tracking-[0.2em] text-cream">
            <FormattedMessage id="landing.badge" />
          </span>
        </Reveal>

        <Reveal delay={120}>
          <h1 className="max-w-[780px] font-display text-[clamp(34px,10.5vw,44px)] font-black leading-[1.02] tracking-[-0.015em] min-[700px]:text-[clamp(38px,6.4vw,78px)]">
            <FormattedMessage
              id="landing.heading"
              values={{
                em: (chunks: ReactNode) => <em className="italic text-persimmon-deep">{chunks}</em>,
              }}
            />
          </h1>
        </Reveal>

        <Reveal delay={240}>
          <p className="mb-[34px] mt-6 max-w-[460px] text-[16.5px] leading-[1.55] text-espresso-soft">
            <FormattedMessage id="landing.subtitle" />
          </p>
        </Reveal>

        <Reveal delay={360}>
          {IS_PUBLIC_SITE ? (
            <a
              href="https://github.com/espetro/dits/blob/main/docs/setup.md"
              target="_blank"
              rel="noreferrer"
              className={ctaClass}
            >
              {cta}
            </a>
          ) : (
            <Link to={withLocale(locale, "/setup")} className={ctaClass}>
              {cta}
            </Link>
          )}
        </Reveal>

        <Reveal delay={480} className="mt-14 w-full flex justify-center">
          <div
            role="img"
            aria-label={intl.formatMessage({ id: "landing.peek.aria" })}
            className="relative w-[min(860px,100%)] overflow-hidden rounded-t-[28px] border border-b-0 border-hairline bg-paper text-left shadow-[0_-18px_60px_-20px_rgba(43,33,24,0.16),0_2px_6px_rgba(43,33,24,0.04)]"
          >
            <div className="flex h-10 flex-none items-center justify-between border-b border-hairline px-[14px] text-[11px] text-espresso-soft">
              <span className="flex items-center gap-2 font-semibold text-espresso">
                <span className="font-display text-sm font-black">di.</span>
                <FormattedMessage id="landing.peek.scenario" />
              </span>
              <span className="tabular-nums max-[700px]:hidden">
                <FormattedMessage id="landing.peek.time" />
              </span>
            </div>
            <div className="grid grid-cols-1 gap-[10px] p-[10px] min-[700px]:grid-cols-[minmax(300px,38%)_1fr]">
              <div className="flex min-h-0 flex-col rounded-[14px] border border-hairline bg-paper p-3">
                <span className="mb-2 inline-flex self-start rounded-full bg-persimmon-faint px-[10px] py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-persimmon-deep">
                  <FormattedMessage id="landing.peek.qchip" />
                </span>
                <div className="flex items-center gap-[10px] border-b border-hairline pb-[10px]">
                  <div className="peek-orb" />
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-espresso-soft">
                      <FormattedMessage id="interview.phase.listening" />
                    </p>
                    <p className="font-display text-[13.5px] leading-[1.3] text-espresso">
                      <FormattedMessage id="landing.peek.caption" />
                    </p>
                  </div>
                </div>
                <div className="flex flex-col gap-[9px] py-[10px]">
                  {PEEK_ROWS.map((row) => (
                    <div key={row.id} className="flex gap-[7px] text-[11.5px] leading-[1.45]">
                      <span className="w-9 flex-none pt-[2px] text-[9px] font-bold uppercase tracking-[0.1em] text-espresso-faint">
                        <FormattedMessage
                          id={
                            row.speaker === "agent"
                              ? "landing.peek.who.agent"
                              : "landing.peek.who.you"
                          }
                        />
                      </span>
                      <span
                        className={row.speaker === "agent" ? "text-espresso-soft" : "text-espresso"}
                      >
                        <FormattedMessage id={row.id} />
                      </span>
                    </div>
                  ))}
                </div>
                <PeekWave />
                <div className="flex pt-2">
                  <span className="flex-1 rounded-full border border-hairline px-[13px] py-[7px] text-[11.5px] text-espresso-faint">
                    <FormattedMessage id="interview.talkOrType" />
                  </span>
                </div>
              </div>
              <aside className="hidden min-[700px]:flex flex-col gap-2 rounded-[14px] border border-hairline bg-cream-deep p-3">
                <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-espresso-faint">
                  <FormattedMessage id="landing.peek.notes" />
                </span>
                {["landing.peek.note1", "landing.peek.note2"].map((id) => (
                  <div
                    key={id}
                    className="rounded-[9px] border border-hairline bg-paper px-[11px] py-[9px] text-[11px] text-espresso-soft"
                  >
                    <FormattedMessage
                      id={id}
                      values={{
                        b: (chunks: ReactNode) => (
                          <b className="font-semibold text-espresso">{chunks}</b>
                        ),
                      }}
                    />
                  </div>
                ))}
              </aside>
            </div>
            <div className="absolute bottom-[10px] left-1/2 flex -translate-x-1/2 items-center gap-[6px] rounded-full bg-espresso px-2 py-[6px] shadow-[0_10px_26px_rgba(43,33,24,0.28)]">
              <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-cream/[0.08]">
                <Mic className="h-[13px] w-[13px] text-cream" aria-hidden="true" />
              </span>
              <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-cream/[0.08]">
                <AlignLeft className="h-[13px] w-[13px] text-cream" aria-hidden="true" />
              </span>
              <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-persimmon-deep">
                <X className="h-[13px] w-[13px] text-cream" aria-hidden="true" />
              </span>
            </div>
          </div>
        </Reveal>
      </main>
    </div>
  );
}
