import * as React from "react";
import { useStore } from "@nanostores/react";
import { FormattedMessage, useIntl } from "react-intl";
import { ExternalLink } from "lucide-react";

import { SettingsRow } from "./settings-row";
import { Button } from "./vendor/button";
import { $seamHealth, reportIssueUrl } from "../lib/seam-health";
import type { SeamId } from "../lib/seam-health";
import { openSettings } from "./settings-nav";

const SEAMS: readonly SeamId[] = ["stt", "tts", "llm"];

/** reason slug -> what to do about it (settings.status.action.*) */
function actionFor(reason: string | undefined): string {
  switch (reason) {
    case "server.unreachable":
      return "settings.status.action.server";
    case "stt.unsupported":
    case "tts.unsupported":
      return "settings.status.action.unsupported";
    case "stt.needsConsent":
    case "tts.needsConsent":
    case "stt.notDownloaded":
    case "tts.notDownloaded":
      return "settings.status.action.download";
    case "stt.noEndpoint":
      return "settings.status.action.sttEndpoint";
    case "tts.noEndpoint":
      return "settings.status.action.ttsEndpoint";
    case "llm.unconfigured":
      return "settings.status.action.llm";
    default:
      return "settings.status.action.retry";
  }
}

function statusTitle(id: string | undefined): string {
  switch (id) {
    case "server.unreachable":
      return "settings.status.reason.server";
    case "stt.unsupported":
    case "tts.unsupported":
      return "settings.status.reason.unsupported";
    case "stt.needsConsent":
    case "tts.needsConsent":
      return "settings.status.reason.consent";
    case "stt.notDownloaded":
    case "tts.notDownloaded":
      return "settings.status.reason.notDownloaded";
    case "stt.noEndpoint":
    case "tts.noEndpoint":
      return "settings.status.reason.noEndpoint";
    case "llm.unconfigured":
      return "settings.status.reason.llmUnconfigured";
    default:
      return "settings.status.reason.error";
  }
}

/**
 * Settings -> system status: one row per seam with up/down, the reason it
 * is down and what to do about it, plus the report-issue button that opens
 * a prefilled github issue (diagnostics included).
 */
export function StatusPane() {
  const intl = useIntl();
  const health = useStore($seamHealth);

  async function report() {
    window.open(await reportIssueUrl(), "_blank", "noopener");
  }

  return (
    <div className="space-y-1">
      <p className="pb-3 text-xs text-muted-foreground">
        <FormattedMessage id="settings.status.intro" />
      </p>
      {SEAMS.map((seam) => {
        const s = health[seam];
        const down = s.state === "down";
        return (
          <SettingsRow
            key={seam}
            title={intl.formatMessage({ id: `settings.status.seam.${seam}` })}
            description={intl.formatMessage({
              id: down ? statusTitle(s.reason) : "settings.status.ok",
            })}
          >
            <span className="flex items-center gap-2">
              <span
                className={
                  "inline-block h-1.5 w-1.5 rounded-full " + (down ? "bg-persimmon" : "bg-sage")
                }
                aria-hidden="true"
              />
              <span className="text-xs text-muted-foreground">
                <FormattedMessage id={down ? "settings.status.down" : "settings.status.up"} />
              </span>
              {down && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs underline underline-offset-2"
                  onClick={() => openSettings("voice")}
                >
                  <FormattedMessage id={actionFor(s.reason)} />
                </Button>
              )}
            </span>
          </SettingsRow>
        );
      })}
      <div className="pt-4 pl-1">
        <Button type="button" variant="outline" size="sm" onClick={() => void report()}>
          <ExternalLink className="size-3.5" aria-hidden="true" />
          <FormattedMessage id="settings.status.reportIssue" />
        </Button>
        <p className="pt-2 text-xs text-muted-foreground">
          <FormattedMessage id="settings.status.reportHint" />
        </p>
      </div>
    </div>
  );
}
