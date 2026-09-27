import * as React from "react";
import { useIntl } from "react-intl";
import { useLocation } from "@tanstack/react-router";

import { SettingsRow } from "./settings-row";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./vendor/select";
import { LOCALE_LABELS } from "./locale-switcher";
import { replaceLocale, useLocale } from "../lib/locale-href";
import { $draft, $interviewLanguage, LOCALES } from "../stores/session";
import { useSsrStore } from "../lib/ssr";

/** Interview-language options (the setup page's LANGUAGES list). */
const INTERVIEW_LANGUAGES = ["en", "es", "fr", "de", "it", "pt-BR", "ja", "ko", "zh-CN", "ar"];

function languageName(tag: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/**
 * Settings -> language: app language (UI copy, drives the url locale) and
 * the default interview language new sessions start with.
 */
export function LanguagePane() {
  const intl = useIntl();
  const locale = useLocale();
  const { pathname } = useLocation();
  const interviewLanguage = useSsrStore($interviewLanguage, "en");

  const pickAppLanguage = (next: string) => {
    // app locale lives in the url; swap the prefix and reload so the whole
    // tree re-renders under it
    window.location.assign(replaceLocale(pathname, next));
  };

  const pickInterviewLanguage = (next: string) => {
    $interviewLanguage.set(next);
    const draft = $draft.get();
    if (draft.language !== next) $draft.set({ ...draft, language: next });
  };

  return (
    <div className="space-y-1">
      <SettingsRow
        title={intl.formatMessage({ id: "settings.language.app" })}
        description={intl.formatMessage({ id: "settings.language.appDesc" })}
      >
        <Select value={locale} onValueChange={pickAppLanguage}>
          <SelectTrigger
            size="sm"
            className="w-48"
            aria-label={intl.formatMessage({ id: "settings.language.app" })}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LOCALES.map((l) => (
              <SelectItem key={l} value={l} lang={l}>
                {LOCALE_LABELS[l].native}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>

      <SettingsRow
        title={intl.formatMessage({ id: "settings.language.interview" })}
        description={intl.formatMessage({ id: "settings.language.interviewDesc" })}
      >
        <Select value={interviewLanguage} onValueChange={pickInterviewLanguage}>
          <SelectTrigger
            size="sm"
            className="w-48"
            aria-label={intl.formatMessage({ id: "settings.language.interview" })}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INTERVIEW_LANGUAGES.map((l) => (
              <SelectItem key={l} value={l} lang={l}>
                {languageName(l, locale)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>
    </div>
  );
}
