import { FormattedMessage, useIntl } from "react-intl";
import { useStore } from "@nanostores/react";

import { $seamHealth, chipState } from "../lib/seam-health";
import { openSettings } from "./settings-nav";
import { Button } from "./vendor/button";

/**
 * Header seam-health indicator, replacing the runtime-mode button:
 * every seam up -> a green dot on a seamless (navbar-colored) chip; any
 * seam down -> orange dot + tint naming the failing layer ("stt down",
 * or "unstable" for several); all three down -> red "offline". Clicking
 * opens settings on the system-status view.
 */
export function StatusChip() {
  const intl = useIntl();
  const health = useStore($seamHealth);
  const state = chipState(health);

  const ok = state === "ok";
  const offline = state === "offline";
  const label =
    state === "ok"
      ? null
      : state === "offline"
        ? "chip.offline"
        : state.down.length === 1
          ? `chip.${state.down[0]}Down`
          : "chip.unstable";

  return (
    <Button
      variant="outline"
      aria-label={intl.formatMessage({ id: "a11y.status" })}
      title={intl.formatMessage({ id: "chip.title" })}
      onClick={() => openSettings("status")}
      className={
        "gap-2 rounded-full border-hairline px-3 py-1.5 text-[10px] font-mono font-medium lowercase tracking-wide " +
        (ok
          ? "border-transparent bg-transparent px-2 hover:bg-white"
          : offline
            ? "border-red-300/60 bg-red-100/50 text-red-700 hover:bg-red-100/70 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-300"
            : "border-persimmon/40 bg-butter/30 text-persimmon-deep hover:bg-butter/40")
      }
    >
      <span
        className={
          "inline-block h-1.5 w-1.5 rounded-full " +
          (ok ? "bg-sage" : offline ? "bg-red-500" : "bg-persimmon animate-pulse")
        }
        aria-hidden="true"
      />
      {label && <FormattedMessage id={label} />}
    </Button>
  );
}
