import { createFileRoute, Link } from "@tanstack/react-router";
import { useLocale, withLocale } from "../../lib/locale-href";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { FormattedMessage } from "react-intl";
import { getSession } from "../../lib/api";
import { Button } from "../../components/vendor/button";

export const Route = createFileRoute("/{-$locale}/validate/$id")({
  component: Validate,
});

function Validate() {
  const { id } = Route.useParams();
  const locale = useLocale();
  const { data: session } = useQuery({
    queryKey: ["session", id],
    queryFn: () => getSession(id),
  });

  return (
    <div className="ambient grain min-h-[100dvh] bg-cream">
      <main className="mx-auto grid w-full max-w-6xl gap-6 px-4 pb-24 pt-10 md:grid-cols-[1.2fr_1fr] md:px-8">
        <div className="rise-in rounded-shell bg-paper p-2 ring-1 ring-hairline">
          <div className="flex h-96 flex-col items-center justify-center gap-3 rounded-[calc(2rem-0.375rem)] bg-cream p-8 text-center">
            <p className="font-display text-lg font-semibold">
              <FormattedMessage id="validate.comingLater" />
            </p>
            <p className="max-w-xs text-sm text-espresso-soft">
              <FormattedMessage id="validate.comingLaterBody" />
            </p>
          </div>
        </div>

        <div
          className="rise-in rounded-shell bg-paper p-2 ring-1 ring-hairline"
          style={{ "--rise-delay": "150ms" } as React.CSSProperties}
        >
          <div className="rounded-[calc(2rem-0.375rem)] bg-cream p-6">
            <h2 className="text-[10px] uppercase tracking-[0.2em] font-medium text-espresso-soft">
              <FormattedMessage id="validate.plan" />
            </h2>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
                <dt className="text-espresso-soft">
                  <FormattedMessage id="validate.type" />
                </dt>
                <dd>{session?.title}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
                <dt className="text-espresso-soft">
                  <FormattedMessage id="validate.duration" />
                </dt>
                <dd>{session?.duration_min} min</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
                <dt className="text-espresso-soft">
                  <FormattedMessage id="validate.mode" />
                </dt>
                <dd>{session?.mode}</dd>
              </div>
            </dl>
          </div>
        </div>
      </main>

      <div className="mx-auto flex w-full max-w-6xl justify-end px-4 pb-16 md:px-8">
        <Button
          asChild
          className="w-full rounded-full bg-espresso px-7 py-3.5 h-auto font-display font-semibold text-cream duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-persimmon active:scale-[0.98] sm:w-auto"
        >
          <Link to={withLocale(locale, `/interview/${id}`)} className="group">
            <FormattedMessage id="validate.start" />
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-cream/15 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-1 group-hover:scale-105">
              →
            </span>
          </Link>
        </Button>
      </div>
    </div>
  );
}
