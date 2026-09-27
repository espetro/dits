import { useLocation } from "@tanstack/react-router";
import { IntlProvider, createIntl, createIntlCache } from "react-intl";
import type { IntlShape } from "react-intl";
import type { ReactNode } from "react";

import { LOCALES, RTL_LOCALES } from "../stores/session";
import { localeFromPathname } from "../lib/locale-href";
import de from "./de.json";
import ar from "./ar.json";
import en from "./en.json";
import es from "./es.json";
import fr from "./fr.json";
import it from "./it.json";
import ja from "./ja.json";
import ko from "./ko.json";
import ptBR from "./pt-br.json";
import zhCN from "./zh-cn.json";

/** intl-ai `fill` emits nested objects for dotted keys; locale files are flat. */
function flattenMessages(tree: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const id = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[id] = value;
    else if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(out, flattenMessages(value as Record<string, unknown>, id));
    }
  }
  return out;
}

// en is spread under every locale: a key missing from a translated file
// renders English rather than the raw id (intl-ai fills in stages).
const MESSAGES: Record<string, Record<string, string>> = Object.fromEntries(
  Object.entries({
    en,
    de,
    es,
    fr,
    ja,
    "pt-br": ptBR,
    "zh-cn": zhCN,
    ko,
    it,
    ar,
  }).map(([locale, msgs]) => [locale, { ...flattenMessages(en), ...flattenMessages(msgs) }]),
);

const intlCache = createIntlCache();

/**
 * Non-hook IntlShape for route head()/error boundaries — bound to the URL
 * locale so localized strings work outside React's provider tree.
 */
export function intlFor(locale: string): IntlShape {
  const resolved = MESSAGES[locale] ? locale : "en";
  return createIntl(
    { locale: resolved, defaultLocale: "en", messages: MESSAGES[resolved] },
    intlCache,
  );
}

export { localeFromPathname };

/** Returns true when the active locale is written right-to-left (drives html dir). */
export function useIsRtl(): boolean {
  return RTL_LOCALE_SET.has(useUrlLocale());
}

const RTL_LOCALE_SET: ReadonlySet<string> = new Set(RTL_LOCALES);

/** Locale for the <html lang> attribute: always derived from the URL. */
export function useHtmlLang(): string {
  return useUrlLocale();
}

/** Locale comes from the optional `{-$locale}` URL prefix present on every
 *  route, so it is known at prerender and hydration time alike — no
 *  store/localStorage read, no hydration-mismatch risk. */
function useUrlLocale(): string {
  const pathname = useLocation({ select: (l) => l.pathname });
  return localeFromPathname(pathname);
}

/** IntlProvider bound to the URL-derived locale, falling back to en. */
export function AppIntlProvider({ children }: { children: ReactNode }) {
  const locale = useUrlLocale();
  return (
    <IntlProvider
      locale={locale}
      defaultLocale="en"
      messages={MESSAGES[locale] ?? MESSAGES.en}
      onError={() => {}}
    >
      {children}
    </IntlProvider>
  );
}

export { LOCALES };
