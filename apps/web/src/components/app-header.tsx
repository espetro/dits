import { Link } from "@tanstack/react-router";
import { Github } from "lucide-react";
import type { ReactNode } from "react";

import { useLocale, withLocale } from "../lib/locale-href";
import { UserDropdown } from "./user-dropdown";

/**
 * Shared app header mounted in __root for every route. Logo links home (en is
 * canonical for the bare root); center slot carries a localized page title;
 * right slot has the GitHub link and the account dropdown (B3). The language
 * selector is not in the header: it lives in the account dropdown and, on the
 * landing hero, as a floating bottom-right pill.
 */
export function AppHeader({ title }: { title?: ReactNode }) {
  const locale = useLocale();
  return (
    <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-4 pt-8 md:px-8">
      <Link
        to={withLocale(locale, "/") as "/{-$locale}"}
        className="font-display text-xl font-bold tracking-tight transition-fluid active:scale-[0.98]"
      >
        di<span className="text-persimmon">.</span>
      </Link>
      <div className="hidden flex-1 px-4 text-center text-sm font-normal text-espresso-soft sm:block">
        {title}
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        <a
          href="https://github.com/espetro/dits"
          target="_blank"
          rel="noreferrer"
          aria-label="GitHub"
          className="flex h-8 w-8 items-center justify-center rounded-full text-espresso-soft transition-fluid hover:text-espresso"
        >
          <Github className="h-4 w-4" aria-hidden="true" />
        </a>
        <UserDropdown />
      </div>
    </header>
  );
}

export function AppHeaderLink({ to, children }: { to: string; children: ReactNode }) {
  const locale = useLocale();
  return (
    <Link to={withLocale(locale, to)} className="transition-fluid hover:text-espresso">
      {children}
    </Link>
  );
}
