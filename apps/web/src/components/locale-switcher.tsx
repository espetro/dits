import { useLocation } from "@tanstack/react-router";
import { useIntl } from "react-intl";
import { Check, ChevronDown } from "lucide-react";

import { LOCALES } from "../stores/session";
import { replaceLocale, useLocale } from "../lib/locale-href";
import { Button } from "./vendor/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./vendor/dropdown-menu";

/**
 * Pill dropdown language switcher, ported from brioso's LanguageSwitcher.
 *
 * Trigger shows a language-code chip + the native name; the menu has one row
 * per locale navigating to the same path under the target locale prefix,
 * preserving pathname (search/hash come from the router location but the app
 * doesn't use them, so only the pathname is rewritten). Active row carries a
 * checkmark.
 *
 * Chips render the uppercase language subtag (EN, PT, ZH...) rather than flag
 * emoji: flag glyphs need a color-emoji flag font that Windows and some Linux
 * installs don't ship, so they degrade to bare two-letter boxes.
 *
 * Rows are plain `<a>` elements, deliberately not TanStack's `<Link>` (same
 * reasoning as brioso): our hrefs are plain optional-prefix paths so Link
 * would technically work, but native anchors keep parity with the source
 * design and avoid typed-route friction with the `{-$locale}` segment.
 */

export const LOCALE_LABELS = {
  en: { native: "English" },
  de: { native: "Deutsch" },
  es: { native: "Español" },
  fr: { native: "Français" },
  ja: { native: "日本語" },
  "pt-br": { native: "Português (Brasil)" },
  "zh-cn": { native: "简体中文" },
  ko: { native: "한국어" },
  it: { native: "Italiano" },
  ar: { native: "العربية" },
} as const satisfies Record<(typeof LOCALES)[number], { native: string }>;

const localeCode = (l: string) => l.replace(/-.*/, "").toUpperCase();

function LocaleChip({ code }: { code: string }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-[22px] flex-none place-items-center rounded-full border border-hairline bg-cream-deep text-[8px] font-bold tracking-[0.04em] text-espresso-soft"
    >
      {code}
    </span>
  );
}

export function LocaleSwitcher({ className = "" }: { className?: string }) {
  const intl = useIntl();
  const { pathname } = useLocation();
  const locale = useLocale() as (typeof LOCALES)[number];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          aria-label={intl.formatMessage({ id: "a11y.language" })}
          className={
            "gap-2 rounded-full border-hairline bg-white px-3 py-1.5 text-xs font-medium text-espresso-soft hover:border-persimmon/50 hover:bg-white hover:text-espresso " +
            className
          }
        >
          <LocaleChip code={localeCode(locale)} />
          {LOCALE_LABELS[locale].native}
          <ChevronDown className="size-3.5 text-espresso-soft" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-52 rounded-xl border-border/70 bg-popover shadow-2xl p-1.5"
      >
        {LOCALES.map((l) => {
          const isActive = l === locale;
          const label = LOCALE_LABELS[l];
          return (
            <DropdownMenuItem key={l} asChild className="cursor-pointer rounded-lg px-2.5 py-2">
              <a
                href={replaceLocale(pathname, l)}
                aria-current={isActive ? "true" : undefined}
                lang={l}
              >
                <LocaleChip code={localeCode(l)} />
                <span className="font-medium text-espresso">{label.native}</span>
                {isActive && <Check className="ml-auto size-4 text-persimmon" aria-hidden="true" />}
              </a>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
