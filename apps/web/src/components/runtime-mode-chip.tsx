import { FormattedMessage, useIntl } from "react-intl";
import { useSsrStore } from "../lib/ssr";

import type { RuntimeMode } from "@di/shared";
import { $effectiveRuntime, $runtimeMode, $serverReachable } from "../lib/runtime";
import { openSettings } from "./settings-nav";
import { Button } from "./vendor/button";

/**
 * Header runtime status indicator: shows the EFFECTIVE runtime (tinted when
 * it differs from the chosen one — server picked but unreachable). Clicking
 * opens settings -> advanced, where the mode can be changed.
 */

const MODE_LABELS: Record<RuntimeMode, string> = {
  server: "runtime.server",
  custom: "runtime.custom",
  "in-browser": "runtime.inBrowser",
};

export function RuntimeModeChip() {
  const intl = useIntl();
  const chosen = useSsrStore($runtimeMode, "server");
  const effective = useSsrStore($effectiveRuntime, "server");
  const reachable = useSsrStore($serverReachable, null);
  const degraded = chosen !== effective;
  const effectiveLabel = MODE_LABELS[effective] ?? "runtime.custom";

  return (
    <Button
      variant="outline"
      aria-label={intl.formatMessage({ id: "a11y.runtimeMode" })}
      title={
        degraded && chosen === "server" && reachable === false
          ? intl.formatMessage({ id: "runtime.degradedTitle" }, { chosen, effective })
          : undefined
      }
      onClick={() => openSettings("advanced")}
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
    </Button>
  );
}
