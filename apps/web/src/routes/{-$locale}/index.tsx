import { createFileRoute } from "@tanstack/react-router";
import { LandingPage } from "../../components/landing-page";
import { intlFor } from "../../locales/i18n";

export const Route = createFileRoute("/{-$locale}/")({
  head: ({ params }) => ({
    meta: [{ title: intlFor(params.locale ?? "en").formatMessage({ id: "meta.title.index" }) }],
  }),
  component: LandingPage,
});
