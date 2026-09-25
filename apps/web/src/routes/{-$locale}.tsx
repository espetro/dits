import { Outlet, createFileRoute, notFound } from "@tanstack/react-router";
import { LOCALES } from "../stores/session";

const PREFIXED_LOCALES = LOCALES.filter((l) => l !== "en");

// optional `{-$locale}` segment: matches `/` (en, param undefined) and `/es` etc.
// layout-only route: validates the locale prefix, renders nothing itself.
export const Route = createFileRoute("/{-$locale}")({
  beforeLoad: ({ params }) => {
    if (
      params.locale !== undefined &&
      !PREFIXED_LOCALES.includes(params.locale as (typeof PREFIXED_LOCALES)[number])
    ) {
      throw notFound();
    }
  },
  component: Outlet,
});
