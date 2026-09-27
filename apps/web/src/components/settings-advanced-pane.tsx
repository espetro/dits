import * as React from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Check, ChevronDown, Loader2, X } from "lucide-react";

import { sectionIncomplete, useModelOptions, useSettingsDrafts } from "./settings-drafts";
import type { SectionKey } from "./settings-drafts";
import { SettingsRow } from "./settings-row";
import { EndpointFields } from "./endpoint-fields";
import { Button } from "./vendor/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./vendor/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./vendor/select";
import { Separator } from "./vendor/separator";
import {
  $effectiveRuntime,
  $providerProfile,
  $runtimeMode,
  $serverReachable,
  probeServer,
  redactKey,
} from "../lib/runtime";
import type { RuntimeMode } from "@di/shared";
import { useSsrStore } from "../lib/ssr";
import { hasBrowserStt } from "../lib/settings-tests";

const RUNTIME_MODES: RuntimeMode[] = ["server", "custom", "in-browser"];

/**
 * Settings -> advanced: runtime mode, api flavor, and the custom speech
 * endpoints (stt/tts). Labeled "most people never need this" — the plain
 * controls live on the voice & microphone and interviewer ai panes.
 */
export function AdvancedPane() {
  const intl = useIntl();
  const chosen = useSsrStore($runtimeMode, "server");
  const effective = useSsrStore($effectiveRuntime, "server");
  const reachable = useSsrStore($serverReachable, null);
  const degraded = chosen !== effective;

  const chooseRuntime = (value: string) => {
    const mode = value as RuntimeMode;
    $runtimeMode.set(mode);
    if (mode === "server") void probeServer();
  };

  return (
    <div className="space-y-1">
      <SettingsRow
        title={intl.formatMessage({ id: "settings.advanced.runtime" })}
        description={
          degraded && chosen === "server" && reachable === false
            ? intl.formatMessage(
                { id: "runtime.unreachable" },
                {
                  fallback: intl.formatMessage({
                    id: `runtime.${effective === "in-browser" ? "inBrowser" : effective}`,
                  }),
                },
              )
            : intl.formatMessage({ id: "settings.advanced.runtimeDesc" })
        }
      >
        <Select value={chosen} onValueChange={chooseRuntime}>
          <SelectTrigger
            size="sm"
            className="w-56"
            aria-label={intl.formatMessage({ id: "settings.advanced.runtime" })}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RUNTIME_MODES.map((mode) => (
              <SelectItem key={mode} value={mode}>
                {intl.formatMessage({ id: `settings.advanced.runtime.${mode}` })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>

      <ApiFlavorRow />

      <Separator className="my-4" />
      <p className="pb-2 pl-1 text-xs font-medium text-muted-foreground">
        <FormattedMessage id="settings.advanced.endpoints" />
      </p>
      <EndpointSection section="stt" />
      <EndpointSection section="tts" />
    </div>
  );
}

function ApiFlavorRow() {
  const intl = useIntl();
  const { drafts, update } = useSettingsDrafts();
  const draft = drafts.llm;
  return (
    <SettingsRow
      title={intl.formatMessage({ id: "settings.flavor" })}
      description={intl.formatMessage({ id: "settings.flavorHelp" })}
    >
      <Select
        value={draft.flavor}
        onValueChange={(v) => update("llm", { flavor: v as "openai" | "anthropic" })}
        disabled={draft.llmMode === "browser"}
      >
        <SelectTrigger
          size="sm"
          className="w-56"
          aria-label={intl.formatMessage({ id: "settings.flavor" })}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="openai">
            {intl.formatMessage({ id: "settings.flavor.openai" })}
          </SelectItem>
          <SelectItem value="anthropic">
            {intl.formatMessage({ id: "settings.flavor.anthropic" })}
          </SelectItem>
        </SelectContent>
      </Select>
    </SettingsRow>
  );
}

function EndpointSection(props: { section: Exclude<SectionKey, "llm"> }) {
  const intl = useIntl();
  const profile = useSsrStore($providerProfile, null);
  const { drafts, update, testState, testing, runTest } = useSettingsDrafts();
  const draft = drafts[props.section];
  const modelOptions = useModelOptions(draft);
  const section = props.section;
  const state = testState[section];
  const incomplete = sectionIncomplete(section, draft);

  const browserCapable =
    typeof window !== "undefined" &&
    (section === "stt" ? hasBrowserStt() : "speechSynthesis" in window);

  return (
    <Collapsible className="rounded-lg border border-border">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-medium hover:bg-muted/40">
        <span>
          <FormattedMessage id={`settings.advanced.endpoints.${section}`} />
        </span>
        <span className="flex items-center gap-2">
          <span className="text-xs font-normal text-muted-foreground">
            {draft.enabled ? (
              <FormattedMessage id="settings.customEndpoint" />
            ) : (
              <FormattedMessage id="settings.voice.builtin" />
            )}
          </span>
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 border-t border-border px-3 py-4">
        <Select
          value={draft.enabled ? "custom" : "builtin"}
          onValueChange={(v) => update(section, { enabled: v === "custom" })}
        >
          <SelectTrigger
            size="sm"
            className="w-56"
            aria-label={intl.formatMessage({ id: `settings.advanced.endpoints.${section}` })}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="builtin">
              {intl.formatMessage({ id: "settings.advanced.endpointBuiltin" })}
            </SelectItem>
            <SelectItem value="custom">
              {intl.formatMessage({ id: "settings.customEndpoint" })}
            </SelectItem>
          </SelectContent>
        </Select>
        {incomplete && (
          <p className="text-xs font-medium text-persimmon-deep">
            <FormattedMessage id="settings.incomplete" />
          </p>
        )}
        {draft.enabled && (
          <EndpointFields
            tab={section}
            draft={draft}
            savedApiKey={
              profile?.[section]
                ? redactKey(("apiKey" in profile[section] ? profile[section].apiKey : "") as string)
                : null
            }
            modelOptions={modelOptions}
            onChange={(patch) => update(section, patch)}
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void runTest(section)}
            disabled={(!draft.enabled && !browserCapable) || testing === section}
            aria-busy={testing === section}
          >
            {testing === section ? (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                <FormattedMessage id="settings.testing" />
              </>
            ) : (
              <FormattedMessage id="settings.test" />
            )}
          </Button>
          {state?.status === "ok" && (
            <span
              role="status"
              className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"
            >
              <Check className="size-3.5" aria-hidden="true" />
              <FormattedMessage id="settings.testOk" />
            </span>
          )}
          {state?.status === "err" && (
            <span role="status" className="flex items-center gap-1 text-xs text-red-600">
              <X className="size-3.5" aria-hidden="true" />
              <FormattedMessage
                id="settings.testFailed"
                values={{ message: state.message ?? "" }}
              />
            </span>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
