import { useLocation } from "@tanstack/react-router";
import { useIntl } from "react-intl";
import { Check, ChevronDown } from "lucide-react";
import FlagAr from "~icons/circle-flags/sa";
import FlagDe from "~icons/circle-flags/de";
import FlagEn from "~icons/circle-flags/us";
import FlagEs from "~icons/circle-flags/es";
import FlagFr from "~icons/circle-flags/fr";
import FlagIt from "~icons/circle-flags/it";
import FlagJa from "~icons/circle-flags/jp";
import FlagKo from "~icons/circle-flags/kr";
import FlagPtBr from "~icons/circle-flags/br";
import FlagZhCn from "~icons/circle-flags/cn";
import type { ComponentType, SVGProps } from "react";

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
 * Trigger shows a circular flag icon + the native name; the menu has one row
 * per locale navigating to the same path under the target locale prefix,
 * preserving pathname (search/hash come from the router location but the app
 * doesn't use them, so only the pathname is rewritten). Active row carries a
 * checkmark.
 *
 * Flags are `circle-flags` SVGs via unplugin-icons (lucide ships no country
 * flags) — not flag emoji, which need a color-emoji flag font that Windows
 * and some Linux installs don't ship.
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

type FlagIcon = ComponentType<SVGProps<SVGSVGElement>>;

export const LOCALE_FLAGS: Record<(typeof LOCALES)[number], FlagIcon> = {
  en: FlagEn,
  de: FlagDe,
  es: FlagEs,
  fr: FlagFr,
  ja: FlagJa,
  "pt-br": FlagPtBr,
  "zh-cn": FlagZhCn,
  ko: FlagKo,
  it: FlagIt,
  ar: FlagAr,
};

function LocaleFlag({ locale }: { locale: (typeof LOCALES)[number] }) {
  const Flag = LOCALE_FLAGS[locale];
  return <Flag className="size-5 flex-none rounded-full" aria-hidden="true" />;
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
          <LocaleFlag locale={locale} />
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
                <LocaleFlag locale={l} />
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
