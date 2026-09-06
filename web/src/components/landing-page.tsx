import * as React from "react";
import { Link } from "@tanstack/react-router";
import { FormattedMessage } from "react-intl";
import { Reveal } from "./reveal";
import { LocaleSwitcher } from "./locale-switcher";
import { useLocaleNav, withLocale } from "../lib/locale-href";

const IS_PUBLIC_SITE = import.meta.env.VITE_PUBLIC_SITE === "1";

/**
 * Sticker field layout: desktop uses a fixed set of non-overlapping grid
 * slots spread across the hero's right band (and below it), so localized
 * sticker text of any length can never overlap the headline or each other.
 * On mount, stickers are shuffled across the slots (per reload) so the
 * composition varies instead of clustering.
 *
 * Slots are expressed as viewport-relative fractions of the hero band and
 * resolved to px at render time (resizes re-shuffle-free: slots are stable,
 * only the assignment is random).
 */
interface Slot {
  x: number;
  xCompact: number;
  y: number;
}

const STICKER_SLOTS: readonly Slot[] = [
  // upper column, far right
  { x: 0.86, xCompact: 0.68, y: 0.06 },
  // mid column
  { x: 0.7, xCompact: 0.58, y: 0.3 },
  // lower right, below the fold line of the hero
  { x: 0.84, xCompact: 0.66, y: 0.4 },
  // mid-left of the band
  { x: 0.66, xCompact: 0.46, y: 0.52 },
  // bottom, right of the CTA but above the locale pill
  { x: 0.8, xCompact: 0.62, y: 0.64 },
];

const STICKERS = [
  { id: "fail", rotate: "-rotate-3", tone: "bg-persimmon-soft", delay: 500 },
  { id: "system", rotate: "rotate-2", tone: "bg-white", delay: 650 },
  { id: "resume", rotate: "-rotate-2", tone: "bg-white", delay: 800 },
  { id: "whyLeave", rotate: "rotate-1", tone: "bg-persimmon-faint", delay: 950 },
  { id: "quickFire", rotate: "-rotate-1", tone: "bg-white", delay: 1100 },
];

/** Fisher-Yates shuffle; returns a new array, does not mutate. */
function shuffled(items: readonly Slot[]): Array<Slot> {
  const out = Array.from(items);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) continue;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/**
 * Assign stickers to grid slots per mount (reload). Keeps stickers in a
 * stable order (so animations stay sequential) while randomizing which slot
 * each lands in.
 */
function assign(count: number): Array<Slot> {
  return shuffled(STICKER_SLOTS).slice(0, count);
}

function useStickerPlacement(count: number): Array<Slot> {
  const [placement, setPlacement] = React.useState(() => assign(count));
  React.useEffect(() => {
    setPlacement(assign(count));
  }, [count]);
  return placement;
}

interface StickerCardProps {
  s: (typeof STICKERS)[number];
  slot: Slot;
}

function StickerCard({ s, slot }: StickerCardProps) {
  return (
    <div
      style={{
        animationDelay: `${s.delay}ms`,
        ["--slot-x" as string]: `${slot.x * 100}%`,
        ["--slot-x-compact" as string]: `${slot.xCompact * 100}%`,
        ["--slot-y" as string]: `${slot.y * 100}%`,
      }}
      className={`rise-in relative ${s.rotate} ${s.tone} mx-2 w-40 rounded-card p-3 font-display text-sm font-medium leading-snug shadow-[0_20px_50px_-20px_rgba(43,33,24,0.25)] ring-1 ring-hairline transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:rotate-0 hover:scale-[1.03] @[42rem]/hero:absolute @[42rem]/hero:left-[var(--slot-x-compact)] @[42rem]/hero:top-[var(--slot-y)] @[42rem]/hero:mx-0 @[54rem]/hero:left-[var(--slot-x)] @[54rem]/hero:w-52 @[54rem]/hero:p-4`}
    >
      “<FormattedMessage id={`landing.sticker.${s.id}`} />”
    </div>
  );
}

export function LandingPage() {
  const { locale } = useLocaleNav();
  const placement = useStickerPlacement(STICKERS.length);
  const placed = STICKERS.map((s, i) => ({ s, slot: placement[i] })).filter(
    (p): p is { s: (typeof STICKERS)[number]; slot: Slot } => p.slot !== undefined,
  );
  const topStickers = placed.filter((p) => p.slot.y < 0.4);
  const bottomStickers = placed.filter((p) => p.slot.y >= 0.4);
  return (
    <div className="ambient grain min-h-[100dvh] bg-cream">
      <main className="@container/hero relative z-10 mx-auto w-full max-w-6xl px-4 pb-32 pt-16 md:px-8 md:pt-28">
        <Reveal>
          <span className="inline-block rounded-full bg-espresso px-3 py-1 text-[10px] uppercase tracking-[0.2em] font-medium text-cream">
            <FormattedMessage id="landing.badge" />
          </span>
        </Reveal>

        {/* sticker field: mobile = flow strips above hero and below CTA;
            band >= 42rem = compact absolute slots, >= 54rem = full scatter,
            shuffled per reload. */}
        <div
          className="flex flex-wrap justify-center gap-3 @[42rem]/hero:contents"
          aria-hidden="true"
        >
          {topStickers.map(({ s, slot }) => (
            <StickerCard key={s.id} s={s} slot={slot} />
          ))}
        </div>

        <Reveal delay={120}>
          <h1 className="mt-8 max-w-3xl font-display text-5xl font-extrabold leading-[1.05] tracking-tight md:text-7xl">
            <FormattedMessage
              id="landing.heading"
              values={{
                em: (chunks: React.ReactNode) => (
                  <span className="text-persimmon-text">{chunks}</span>
                ),
              }}
            />
          </h1>
        </Reveal>

        <Reveal delay={240}>
          <p className="mt-6 max-w-md text-lg text-espresso-soft">
            <FormattedMessage id="landing.subtitle" />
          </p>
        </Reveal>

        <Reveal delay={380}>
          <div className="mt-12">
            {IS_PUBLIC_SITE ? (
              <a
                href="https://github.com/espetro/dits/blob/main/docs/setup.md"
                target="_blank"
                rel="noreferrer"
                className="group inline-flex w-full items-center justify-center gap-3 rounded-full bg-espresso px-7 py-4 font-display text-lg font-semibold text-cream transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-persimmon active:scale-[0.98] sm:w-auto"
              >
                <FormattedMessage id="landing.cta" />
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-cream/15 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-1 group-hover:scale-105">
                  →
                </span>
              </a>
            ) : (
              <Link
                to={withLocale(locale, "/setup")}
                className="group inline-flex w-full items-center justify-center gap-3 rounded-full bg-espresso px-7 py-4 font-display text-lg font-semibold text-cream transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-persimmon active:scale-[0.98] sm:w-auto"
              >
                <FormattedMessage id="landing.cta" />
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-cream/15 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-1 group-hover:scale-105">
                  →
                </span>
              </Link>
            )}
          </div>
        </Reveal>

        {/* bottom band: flow strip below CTA on mobile, grid slots on desktop */}
        <div
          className="mt-6 flex flex-wrap justify-center gap-3 @[42rem]/hero:contents"
          aria-hidden="true"
        >
          {bottomStickers.map(({ s, slot }) => (
            <StickerCard key={s.id} s={s} slot={slot} />
          ))}
        </div>

        <Reveal delay={500}>
          <p className="mt-20 max-w-2xl text-xs uppercase tracking-[0.15em] text-espresso-soft">
            <FormattedMessage id="landing.trust" />
          </p>
        </Reveal>
      </main>
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-20 md:bottom-6">
        <div className="mx-auto w-full max-w-6xl px-4 md:px-8">
          <div className="pointer-events-auto flex justify-end">
            <LocaleSwitcher />
          </div>
        </div>
      </div>
    </div>
  );
}
