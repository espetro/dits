import { useLocation } from "@tanstack/react-router";
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
 * Trigger shows the current locale flag + native name; the menu has one row
 * per locale navigating to the same path under the target locale prefix,
 * preserving pathname (search/hash come from the router location but the app
 * doesn't use them, so only the pathname is rewritten). Active row carries a
 * checkmark.
 *
 * Rows are plain `<a>` elements, deliberately not TanStack's `<Link>` (same
 * reasoning as brioso): our hrefs are plain optional-prefix paths so Link
 * would technically work, but native anchors keep parity with the source
 * design and avoid typed-route friction with the `{-$locale}` segment.
 */

const LOCALE_LABELS = {
  en: { flag: "🇺🇸", native: "English" },
  de: { flag: "🇩🇪", native: "Deutsch" },
  es: { flag: "🇪🇸", native: "Español" },
  fr: { flag: "🇫🇷", native: "Français" },
  ja: { flag: "🇯🇵", native: "日本語" },
  "pt-BR": { flag: "🇧🇷", native: "Português (Brasil)" },
  "zh-CN": { flag: "🇨🇳", native: "简体中文" },
  ko: { flag: "🇰🇷", native: "한국어" },
  it: { flag: "🇮🇹", native: "Italiano" },
  ar: { flag: "🇸🇦", native: "العربية" },
} as const satisfies Record<(typeof LOCALES)[number], { flag: string; native: string }>;

export function LocaleSwitcher({ className = "" }: { className?: string }) {
  const { pathname } = useLocation();
  const locale = useLocale() as (typeof LOCALES)[number];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          aria-label="Language"
          className={
            "gap-2 rounded-full border-hairline bg-white px-3 py-1.5 text-xs font-medium text-espresso-soft hover:border-persimmon/50 hover:bg-white hover:text-espresso " +
            className
          }
        >
          <span aria-hidden="true">{LOCALE_LABELS[locale].flag}</span>
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
                <span aria-hidden="true">{label.flag}</span>
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
