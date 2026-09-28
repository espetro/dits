import { Outlet, createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { LOCALES } from "../stores/session";

const PREFIXED_LOCALES = LOCALES.filter((l) => l !== "en");

// optional `{-$locale}` segment: matches `/` (en, param undefined) and `/es` etc.
// layout-only route: validates the locale prefix, renders nothing itself.
export const Route = createFileRoute("/{-$locale}")({
  beforeLoad: ({ params, location }) => {
    const locale = params.locale;
    if (locale === undefined) return;
    if (PREFIXED_LOCALES.includes(locale as (typeof PREFIXED_LOCALES)[number])) return;
    // legacy mixed-case locale urls (`/pt-BR/...`, `/ES/...`) land on their
    // canonical lowercase equivalents, preserving the rest of the href.
    const lower = locale.toLowerCase();
    if ((PREFIXED_LOCALES as readonly string[]).includes(lower)) {
      throw redirect({
        href: `/${lower}${location.href.slice(locale.length + 1)}`,
        replace: true,
      });
    }
    throw notFound();
  },
  component: Outlet,
});
