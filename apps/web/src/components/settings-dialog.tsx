import { AudioLines, Bot, Download, History, Languages, Wrench, X } from "lucide-react";
import * as React from "react";
import { FormattedMessage, useIntl } from "react-intl";

import { HistoryPane } from "./history-pane";
import { VoicePane } from "./settings-voice-pane";
import { InterviewerAiPane } from "./settings-ai-pane";
import { DownloadsPane } from "./settings-downloads-pane";
import { LanguagePane } from "./settings-language-pane";
import { AdvancedPane } from "./settings-advanced-pane";
import { SettingsDraftsProvider } from "./settings-drafts";
import { clearSettings, openSettings, useSettingsSearch } from "./settings-nav";
import type { SettingsPane } from "./settings-nav";
import { Button } from "./vendor/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./vendor/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./vendor/select";

/**
 * Unified settings dialog: one url-driven surface with a left nav and
 * spotify-style rows (title + one-line description + right control) per
 * pane — past interviews, voice & microphone, interviewer ai, downloads,
 * language, advanced. `?settings=1&pane=…` opens it; the helpers live in
 * settings-nav.ts so panes can cross-link without an import cycle.
 */

export type { SettingsPane };

/** Mount once near the app root: mirrors ?settings&pane onto the dialog. */
export function SettingsDialogHost() {
  const { settings, pane } = useSettingsSearch();
  const open = settings === "1";
  const activePane: SettingsPane = pane ?? "history";
  return (
    <SettingsDialog
      open={open}
      onOpenChange={(next) => (next ? openSettings(activePane) : clearSettings())}
      pane={activePane}
      onPaneChange={(next) => openSettings(next)}
    />
  );
}

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isMobile;
}

/** Pane heading: large display title over a full-width hairline rule. */
function PaneHeading(props: { title: string; description?: string }) {
  return (
    <div className="border-b border-border pb-4">
      <h2 className="text-xl font-semibold tracking-tight">{props.title}</h2>
      {props.description && (
        <p className="mt-1 text-sm text-muted-foreground">{props.description}</p>
      )}
    </div>
  );
}

const NAV: { id: SettingsPane; label: string; icon: React.ReactNode }[] = [
  {
    id: "history",
    label: "settings.nav.history",
    icon: <History className="size-4" aria-hidden="true" />,
  },
  {
    id: "voice",
    label: "settings.nav.voice",
    icon: <AudioLines className="size-4" aria-hidden="true" />,
  },
  {
    id: "ai",
    label: "settings.nav.ai",
    icon: <Bot className="size-4" aria-hidden="true" />,
  },
  {
    id: "downloads",
    label: "settings.nav.downloads",
    icon: <Download className="size-4" aria-hidden="true" />,
  },
  {
    id: "language",
    label: "settings.nav.language",
    icon: <Languages className="size-4" aria-hidden="true" />,
  },
  {
    id: "advanced",
    label: "settings.nav.advanced",
    icon: <Wrench className="size-4" aria-hidden="true" />,
  },
];

const PANE_TITLES: Record<SettingsPane, string> = {
  history: "settings.nav.history",
  voice: "settings.nav.voice",
  ai: "settings.nav.ai",
  downloads: "settings.nav.downloads",
  language: "settings.nav.language",
  advanced: "settings.nav.advanced",
};

function PaneBody({ pane }: { pane: SettingsPane }) {
  switch (pane) {
    case "history":
      return <HistoryPane />;
    case "voice":
      return <VoicePane />;
    case "ai":
      return <InterviewerAiPane />;
    case "downloads":
      return <DownloadsPane />;
    case "language":
      return <LanguagePane />;
    case "advanced":
      return <AdvancedPane />;
  }
}

export function SettingsDialog({ open, onOpenChange, pane, onPaneChange }: SettingsDialogProps) {
  const isMobile = useIsMobile();
  const intl = useIntl();

  const nav = (
    <>
      {NAV.map((item, i) => (
        <React.Fragment key={item.id}>
          {/* cached session data sits apart from actual configuration */}
          {i === 1 && <div role="separator" className="mx-1 my-2 border-t border-border" />}
          <Button
            variant="ghost"
            className={
              "h-9 w-full min-w-0 justify-start gap-2.5 rounded-lg px-3 py-2.5 text-sm font-normal " +
              (pane === item.id
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")
            }
            onClick={() => onPaneChange(item.id)}
          >
            {item.icon}
            <span className="truncate">{intl.formatMessage({ id: item.label })}</span>
          </Button>
        </React.Fragment>
      ))}
    </>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          isMobile
            ? "inset-0 flex h-svh w-screen max-w-none translate-x-0 translate-y-0 flex-col rounded-none border-0 bg-background p-0 [&>button]:hidden"
            : "flex h-[min(40rem,calc(100vh-6rem))] w-[calc(100vw-2rem)] max-w-4xl flex-row gap-0 overflow-hidden rounded-2xl border-border bg-background p-0 shadow-2xl [&>button]:hidden lg:max-w-5xl"
        }
      >
        <DialogTitle className="sr-only">
          <FormattedMessage id="settings.title" />
        </DialogTitle>
        <DialogDescription className="sr-only">
          {NAV.map((item, i) => (
            <React.Fragment key={item.id}>
              {i > 0 && ", "}
              <FormattedMessage id={item.label} />
            </React.Fragment>
          ))}
        </DialogDescription>
        {isMobile ? (
          <div className="flex shrink-0 items-center gap-2 border-b border-border p-2">
            <Select value={pane} onValueChange={(value) => onPaneChange(value as SettingsPane)}>
              <SelectTrigger
                className="h-9 flex-1"
                aria-label={intl.formatMessage({ id: "settings.title" })}
              >
                <SelectValue>{intl.formatMessage({ id: PANE_TITLES[pane] })}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {NAV.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {intl.formatMessage({ id: item.label })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DialogClose
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              onClick={clearSettings}
            >
              <X className="size-4" aria-hidden="true" />
              <span className="sr-only">
                <FormattedMessage id="settings.close" />
              </span>
            </DialogClose>
          </div>
        ) : (
          <nav className="flex w-60 shrink-0 flex-col p-5">
            <div className="pb-5">
              <DialogClose
                className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                onClick={clearSettings}
              >
                <X className="size-4" aria-hidden="true" />
                <span className="sr-only">
                  <FormattedMessage id="settings.close" />
                </span>
              </DialogClose>
            </div>
            <div className="flex flex-col gap-y-1">{nav}</div>
          </nav>
        )}
        <div
          className={
            isMobile
              ? "flex-1 overflow-y-auto p-3"
              : "my-3 mr-3 flex-1 overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-sm"
          }
        >
          <SettingsDraftsProvider>
            {isMobile ? (
              <PaneBody pane={pane} />
            ) : (
              <div
                className={
                  pane === "history" ? "mx-auto max-w-2xl space-y-6" : "mx-auto max-w-xl space-y-6"
                }
              >
                <PaneHeading
                  title={intl.formatMessage({ id: PANE_TITLES[pane] })}
                  description={
                    pane === "advanced"
                      ? intl.formatMessage({ id: "settings.advanced.intro" })
                      : undefined
                  }
                />
                <PaneBody pane={pane} />
              </div>
            )}
          </SettingsDraftsProvider>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pane: SettingsPane;
  onPaneChange: (pane: SettingsPane) => void;
}
