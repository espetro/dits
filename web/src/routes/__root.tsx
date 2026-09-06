import { useEffect } from "react";
import type { ReactNode } from "react";
import {
  Link,
  Outlet,
  createRootRoute,
  HeadContent,
  Scripts,
  useLocation,
  useRouter,
} from "@tanstack/react-router";
import { FormattedMessage } from "react-intl";
import { AlertTriangle } from "lucide-react";

import { AppIntlProvider, useIsRtl } from "../locales/i18n";
import { Button } from "../components/vendor/button";
import { AppHeader } from "../components/app-header";
import { SettingsDialogHost, type SettingsPane } from "../components/settings-dialog";
import { localeFromPathname, withLocale } from "../lib/locale-href";
import { maybeSeedFixtures } from "../lib/dev-fixtures";
import "../theme.css";

export const Route = createRootRoute({
  component: RootDocument,
  errorComponent: RouteError,
  notFoundComponent: NotFound,
});

import { Toaster } from "sonner";

function RootDocument() {
  const isRtl = useIsRtl();

  // RTL support at the html level (e.g. for ar).
  useEffect(() => {
    document.documentElement.dir = isRtl ? "rtl" : "ltr";
  }, [isRtl]);

  // Dev fixture seeding: no-op unless DEV && ?fixtures=1|reset (see lib/dev-fixtures).
  useEffect(() => {
    void maybeSeedFixtures().catch((err) => console.warn("fixtures seed failed", err));
  }, []);

  return (
    <html lang="en" dir={isRtl ? "rtl" : "ltr"}>
      <head>
        <HeadContent />
      </head>
      <body>
        <AppIntlProvider>
          <AppHeaderSlot />
          <Outlet />
          <SettingsDialogHost />
          {/* global, out-of-context events only (voice/report failures) */}
          <Toaster
            position="top-center"
            richColors
            toastOptions={{
              style: {
                background: "var(--color-paper)",
                color: "var(--color-espresso)",
                border: "1px solid var(--color-hairline)",
              },
            }}
          />
        </AppIntlProvider>
        <Scripts />
      </body>
    </html>
  );
}

/**
 * Root-route fallback screens. They render in place of the tree, so they
 * cannot rely on AppIntlProvider being mounted; each wraps itself in
 * ErrorShell, which mounts its own IntlProvider bound to the URL locale.
 */
function RouteError({ error, reset }: { error: unknown; reset?: () => void }) {
  const router = useRouter();
  const message = error instanceof Error ? error.message : "an unexpected error occurred";
  const retry = () => {
    if (reset) reset();
    else void router.invalidate();
  };
  return (
    <ErrorShell>
      <div className="flex flex-col items-center gap-4 text-center">
        <AlertTriangle className="h-10 w-10 text-persimmon" aria-hidden="true" />
        <h1 className="font-display text-3xl font-semibold">
          <FormattedMessage id="error.title" />
        </h1>
        <p className="max-w-md rounded-card bg-cream-deep px-5 py-3 font-mono text-xs break-words text-espresso-soft">
          {message}
        </p>
        <div className="mt-2 flex items-center gap-3">
          <Button
            type="button"
            onClick={retry}
            className="rounded-full bg-gradient-to-br from-persimmon to-persimmon-deep px-5 py-2 h-auto text-white ring-hairline transition-fluid hover:brightness-110 active:scale-[0.98]"
          >
            <FormattedMessage id="error.retry" />
          </Button>
          <ErrorHomeLink />
        </div>
      </div>
    </ErrorShell>
  );
}

function NotFound() {
  return (
    <ErrorShell>
      <div className="flex flex-col items-center gap-4 text-center">
        <p className="font-display text-8xl font-bold tracking-tight text-espresso">
          4<span className="text-persimmon">0</span>4
        </p>
        <p className="max-w-md text-sm text-espresso-soft">
          <FormattedMessage id="notfound.message" />
        </p>
        <div className="mt-2">
          <ErrorHomeLink />
        </div>
      </div>
    </ErrorShell>
  );
}

function ErrorHomeLink() {
  const locale = localeFromPathname(useLocation({ select: (l) => l.pathname }));
  return (
    <Link
      to={withLocale(locale, "/") as "/{-$locale}"}
      className="text-sm text-espresso-soft underline decoration-hairline underline-offset-4 transition-fluid hover:text-espresso"
    >
      <FormattedMessage id="error.home" />
    </Link>
  );
}

/** Full-page shell with its own IntlProvider (URL-derived locale, en fallback). */
function ErrorShell({ children }: { children: ReactNode }) {
  return (
    <AppIntlProvider>
      <div className="ambient grain flex min-h-[100dvh] flex-col items-center justify-center bg-cream px-4">
        {children}
      </div>
    </AppIntlProvider>
  );
}

const TITLES: Array<[RegExp, string]> = [[/\/setup$/, "setup.title"]];

function AppHeaderSlot() {
  const pathname = useLocation({ select: (l) => l.pathname });
  const titleKey = TITLES.find(([re]) => re.test(pathname))?.[1];
  return (
    <AppHeader
      title={
        titleKey ? (
          <h1 className="text-sm font-normal text-espresso-soft">
            <FormattedMessage id={titleKey} />
          </h1>
        ) : undefined
      }
    />
  );
}
