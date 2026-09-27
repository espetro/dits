import * as React from "react";
import * as v from "valibot";

/**
 * URL plumbing for the settings dialog: `?settings=1&pane=…` in the root
 * search params opens it at a pane, so any flow (and any QA agent) can
 * reach it by link. Kept in its own module so panes can navigate (e.g.
 * voice -> downloads) without importing the dialog (no import cycle).
 *
 * Deliberately NOT TanStack validateSearch: the Start dev/prerender server
 * canonicalizes root-route search params and 307s `/?settings=1` to `/`
 * before hydration, so the dialog could never open from a cold URL.
 * Reading the raw query string keeps the params in the address bar for QA
 * agents and deep links.
 */

export type SettingsPane = "history" | "voice" | "ai" | "downloads" | "language" | "advanced";

export const SETTINGS_PANES: readonly SettingsPane[] = [
  "history",
  "voice",
  "ai",
  "downloads",
  "language",
  "advanced",
];

export interface SettingsSearch {
  settings?: "1";
  pane?: SettingsPane;
}

/** Open (or retarget) the settings dialog via URL search params. */
export function openSettings(pane: SettingsPane = "history"): void {
  const url = new URL(window.location.href);
  url.searchParams.set("settings", "1");
  url.searchParams.set("pane", pane);
  window.history.pushState(null, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Close the dialog by dropping its search params (history back if ours). */
export function clearSettings(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("settings");
  url.searchParams.delete("pane");
  window.history.pushState(null, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Reactive read of the settings search params. */
export function useSettingsSearch(): SettingsSearch {
  const [search, setSearch] = React.useState<SettingsSearch>({});
  React.useEffect(() => {
    const update = () => setSearch(parseSettingsSearch(window.location.search));
    update();
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  return search;
}

const LEGACY_PANES: Record<string, SettingsPane> = {
  aiProvider: "ai",
};

function parseSettingsSearch(query: string): SettingsSearch {
  const parsed = v.safeParse(
    v.object({
      settings: v.optional(v.picklist(["1"])),
      pane: v.optional(v.picklist([...SETTINGS_PANES, "aiProvider"])),
    }),
    Object.fromEntries(new URLSearchParams(query)),
  );
  const raw = parsed.success ? parsed.output.pane : undefined;
  return {
    settings: parsed.success ? parsed.output.settings : undefined,
    pane: raw ? (LEGACY_PANES[raw] ?? (raw as SettingsPane)) : undefined,
  };
}
