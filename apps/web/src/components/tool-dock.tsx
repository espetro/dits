import { Suspense } from "react";
import { FormattedMessage } from "react-intl";
import { Plus } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "./vendor/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./vendor/dropdown-menu";
import { Button } from "./vendor/button";
import type { ToolSpec } from "../lib/tools/registry";

/** Tabs beyond this count collapse into the `+` overflow picker (p3-21). */
const MAX_VISIBLE_TABS = 4;

function PaneSkeleton({ label }: { label: string }) {
  return (
    <div className="h-full w-full animate-pulse rounded-2xl bg-espresso/5" aria-label={label} />
  );
}

/**
 * ToolDock (p3-21): registry-driven tabbed tool panes under the
 * QuestionCard. `session.tools` order is tab order; >4 tools collapse
 * trailing tabs into a `+` overflow picker. The active tab is a route
 * search param (`?tool=`), owned by the route.
 */
export function ToolDock({
  specs,
  active,
  onActive,
  loadingLabel,
}: {
  specs: ToolSpec[];
  active: string;
  onActive: (id: string) => void;
  loadingLabel: string;
}) {
  const visible = specs.slice(0, MAX_VISIBLE_TABS);
  const overflow = specs.slice(MAX_VISIBLE_TABS);
  const activeSpec = specs.find((s) => s.id === active) ?? specs[0];
  const Pane = activeSpec?.component;
  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-card bg-paper p-2 ring-1 ring-hairline">
      <Tabs value={activeSpec?.id ?? ""} onValueChange={onActive}>
        <div className="flex items-center gap-1">
          <TabsList className="flex min-w-0 flex-1 gap-1 rounded-full bg-transparent p-1">
            {visible.map((spec) => (
              <TabsTrigger
                key={spec.id}
                value={spec.id}
                className={`min-h-11 flex-none rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] after:hidden ${
                  activeSpec?.id === spec.id
                    ? "bg-espresso text-cream"
                    : "text-espresso-soft hover:bg-cream-deep"
                }`}
              >
                <spec.icon className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">
                  <FormattedMessage id={spec.labelKey} />
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
          {overflow.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label="more tools"
                  className={`size-11 flex-none rounded-full bg-white px-0 text-espresso ring-1 ring-hairline shadow-none hover:bg-white hover:ring-persimmon/50 ${
                    overflow.some((s) => s.id === activeSpec?.id) ? "ring-persimmon/50" : ""
                  }`}
                >
                  <Plus className="size-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-paper">
                {overflow.map((spec) => (
                  <DropdownMenuItem key={spec.id} onClick={() => onActive(spec.id)}>
                    <spec.icon className="size-4" aria-hidden="true" />
                    <FormattedMessage id={spec.labelKey} />
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </Tabs>
      <div className="min-h-0 flex-1 rounded-[calc(1.5rem-0.375rem)] bg-cream p-2 sm:p-4">
        {Pane && (
          <Suspense fallback={<PaneSkeleton label={loadingLabel} />}>
            <Pane />
          </Suspense>
        )}
      </div>
    </section>
  );
}
