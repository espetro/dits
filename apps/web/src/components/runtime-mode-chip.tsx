import { Check, ChevronDown, Server, SlidersHorizontal, Smartphone } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { useSsrStore } from "../lib/ssr";

import type { RuntimeMode } from "@di/shared";
import { $effectiveRuntime, $runtimeMode, $serverReachable, probeServer } from "../lib/runtime";
import { Button } from "./vendor/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./vendor/dropdown-menu";

/**
 * Visible runtime indicator + switcher (p1): the mode is a user choice, not a
 * silent probe outcome. The pill always shows the EFFECTIVE runtime, tinted
 * when it differs from the chosen one (server picked but unreachable). The
 * menu persists the choice to $runtimeMode and reprobes on a server pick.
 */

const MODES: { key: RuntimeMode; icon: typeof Server; label: string }[] = [
  { key: "server", icon: Server, label: "runtime.server" },
  { key: "custom", icon: SlidersHorizontal, label: "runtime.custom" },
  { key: "in-browser", icon: Smartphone, label: "runtime.inBrowser" },
];

function choose(mode: RuntimeMode): void {
  $runtimeMode.set(mode);
  if (mode === "server") void probeServer();
}

export function RuntimeModeChip() {
  const intl = useIntl();
  const chosen = useSsrStore($runtimeMode, "server");
  const effective = useSsrStore($effectiveRuntime, "server");
  const reachable = useSsrStore($serverReachable, null);
  const degraded = chosen !== effective;
  const effectiveLabel = MODES.find((m) => m.key === effective)?.label ?? "runtime.custom";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          aria-label="runtime mode"
          title={degraded ? `chosen: ${chosen}, effective: ${effective}` : undefined}
          className={
            "gap-2 rounded-full border-hairline px-3 py-1.5 text-[10px] font-mono font-medium uppercase tracking-wide hover:border-persimmon/50 hover:bg-white " +
            (degraded
              ? "bg-butter/30 text-persimmon-deep"
              : "bg-white text-espresso-soft hover:text-espresso")
          }
        >
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${degraded ? "bg-persimmon animate-pulse" : "bg-sage"}`}
            aria-hidden="true"
          />
          <FormattedMessage id={effectiveLabel} />
          <ChevronDown className="size-3.5 text-espresso-soft" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="min-w-[16rem] rounded-xl">
        <DropdownMenuLabel className="text-xs">
          <FormattedMessage id="runtime.label" />
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {MODES.map((m) => (
          <DropdownMenuItem
            key={m.key}
            onSelect={() => choose(m.key)}
            className="flex items-center justify-between gap-3"
          >
            <span className="flex items-center gap-2">
              <m.icon className="size-4 text-espresso-soft" aria-hidden="true" />
              <FormattedMessage id={m.label} />
            </span>
            {chosen === m.key && <Check className="size-4" aria-hidden="true" />}
          </DropdownMenuItem>
        ))}
        {chosen === "server" && reachable === false && (
          <>
            <DropdownMenuSeparator />
            <p className="px-2 py-1.5 text-xs text-persimmon-deep">
              <FormattedMessage
                id="runtime.unreachable"
                values={{ fallback: intl.formatMessage({ id: effectiveLabel }) }}
              />
            </p>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
