import { createFileRoute } from "@tanstack/react-router";
import { LandingPage } from "../../components/landing-page";

export const Route = createFileRoute("/{-$locale}/")({
  head: () => ({ meta: [{ title: "di — mock interviews" }] }),
  component: LandingPage,
});
