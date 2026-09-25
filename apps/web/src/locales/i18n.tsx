import { useLocation } from "@tanstack/react-router";
import { IntlProvider } from "react-intl";
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
import ptBR from "./pt-BR.json";
import zhCN from "./zh-CN.json";

const MESSAGES: Record<string, Record<string, string>> = {
  en,
  de,
  es,
  fr,
  ja,
  "pt-BR": ptBR,
  "zh-CN": zhCN,
  ko,
  it,
  ar,
};

export { localeFromPathname };

/** Returns true when the active locale is written right-to-left (drives html dir). */
export function useIsRtl(): boolean {
  return useUrlLocale() in RTL_LOCALE_SET;
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
