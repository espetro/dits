import * as React from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";

import { sectionIncomplete, useModelOptions, useSettingsDrafts } from "./settings-drafts";
import { SettingsRow } from "./settings-row";
import { EndpointFields } from "./endpoint-fields";
import { BrowserLlmManager } from "./browser-llm-manager";
import { Alert, AlertDescription } from "./vendor/alert";
import { Button } from "./vendor/button";
import { RadioGroup, RadioGroupItem } from "./vendor/radio-group";
import { $providerProfile, redactKey } from "../lib/runtime";
import { useSsrStore } from "../lib/ssr";
import { DEMO_LLM, DEMO_LLM_ENABLED, isDemoLlm } from "../lib/demo-llm";

type LlmPick = "demo" | "own" | "browser";

/**
 * Settings -> interviewer ai: the llm pick — demo (recommended), your own
 * ai account, or on-device (experimental). Endpoint fields reveal inline
 * under "own account"; on-device mounts the browser model manager.
 */
export function InterviewerAiPane() {
  const intl = useIntl();
  const profile = useSsrStore($providerProfile, null);
  const { drafts, update, testState, testing, runTest } = useSettingsDrafts();
  const draft = drafts.llm;
  const modelOptions = useModelOptions(draft);

  const pick: LlmPick =
    draft.llmMode === "browser" ? "browser" : isDemoLlm(draft.baseUrl) ? "demo" : "own";

  const choose = (value: string) => {
    const next = value as LlmPick;
    if (next === "demo") {
      update("llm", {
        enabled: true,
        llmMode: "remote",
        baseUrl: DEMO_LLM.baseUrl,
        apiKey: DEMO_LLM.apiKey,
        model: DEMO_LLM.model,
      });
    } else if (next === "own") {
      // leaving the demo endpoint: blank its managed fields so the user
      // edits real values instead of the demo placeholder
      update("llm", {
        enabled: true,
        llmMode: "remote",
        ...(isDemoLlm(draft.baseUrl) ? { baseUrl: "", apiKey: "", model: "" } : {}),
      });
    } else {
      update("llm", { enabled: false, llmMode: "browser" });
    }
  };

  const incomplete = pick === "own" && sectionIncomplete("llm", draft);
  const state = testState.llm;

  return (
    <div className="space-y-1">
      <RadioGroup
        value={pick}
        onValueChange={choose}
        aria-label={intl.formatMessage({ id: "settings.nav.ai" })}
        className="gap-0"
      >
        {DEMO_LLM_ENABLED && (
          <label className="flex cursor-pointer items-start gap-3 py-3">
            <RadioGroupItem value="demo" className="mt-1" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">
                <FormattedMessage id="settings.ai.demo" />
                <span className="ml-2 rounded-full bg-sage/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sage">
                  <FormattedMessage id="settings.ai.recommended" />
                </span>
              </span>
              <span className="block text-xs text-muted-foreground">
                <FormattedMessage id="settings.ai.demoDesc" />
              </span>
            </span>
          </label>
        )}
        <label className="flex cursor-pointer items-start gap-3 py-3">
          <RadioGroupItem value="own" className="mt-1" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">
              <FormattedMessage id="settings.ai.own" />
            </span>
            <span className="block text-xs text-muted-foreground">
              <FormattedMessage id="settings.ai.ownDesc" />
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 py-3">
          <RadioGroupItem value="browser" className="mt-1" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">
              <FormattedMessage id="settings.ai.onDevice" />
              <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <FormattedMessage id="settings.ai.experimental" />
              </span>
            </span>
            <span className="block text-xs text-muted-foreground">
              <FormattedMessage id="settings.ai.onDeviceDesc" />
            </span>
          </span>
        </label>
      </RadioGroup>

      {pick === "own" && (
        <div className="space-y-4 border-t border-border pt-4">
          {incomplete && (
            <Alert variant="destructive">
              <AlertTriangle aria-hidden="true" />
              <AlertDescription>
                <FormattedMessage id="settings.incomplete" />
              </AlertDescription>
            </Alert>
          )}
          <EndpointFields
            tab="llm"
            draft={draft}
            savedApiKey={
              profile?.llm && "apiKey" in profile.llm ? redactKey(profile.llm.apiKey) : null
            }
            modelOptions={modelOptions}
            onChange={(patch) => update("llm", patch)}
            onDemoFill={
              DEMO_LLM_ENABLED
                ? () =>
                    update("llm", {
                      enabled: true,
                      llmMode: "remote",
                      baseUrl: DEMO_LLM.baseUrl,
                      apiKey: DEMO_LLM.apiKey,
                      model: DEMO_LLM.model,
                    })
                : undefined
            }
          />
          <SettingsRow
            title={intl.formatMessage({ id: "settings.ai.test" })}
            description={intl.formatMessage({ id: "settings.ai.testDesc" })}
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void runTest("llm")}
              disabled={testing === "llm"}
              aria-busy={testing === "llm"}
            >
              {testing === "llm" ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  <FormattedMessage id="settings.testing" />
                </>
              ) : (
                <FormattedMessage id="settings.test" />
              )}
            </Button>
          </SettingsRow>
          <TestStatus state={state} />
        </div>
      )}

      {pick === "browser" && (
        <div className="space-y-4 border-t border-border pt-4">
          <Alert>
            <AlertTriangle className="text-persimmon-deep" aria-hidden="true" />
            <AlertDescription>
              <FormattedMessage id="settings.llm.inBrowserWarning" />{" "}
              <strong className="font-semibold">
                <FormattedMessage id="settings.llm.cloudRecommended" />
              </strong>{" "}
              <a
                href="https://huggingface.co/blog/Xenova/run-gemini-nano-in-your-browser"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-persimmon-text"
              >
                <FormattedMessage id="settings.llm.geminiEnableLink" />
              </a>
            </AlertDescription>
          </Alert>
          <BrowserLlmManager
            engine={draft.engine}
            modelId={draft.browserModelId}
            onEngineChange={(engine) => update("llm", { engine })}
            onModelIdChange={(browserModelId) => update("llm", { browserModelId })}
          />
          <SettingsRow
            title={intl.formatMessage({ id: "settings.ai.test" })}
            description={intl.formatMessage({ id: "settings.ai.testDesc" })}
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void runTest("llm")}
              disabled={testing === "llm"}
              aria-busy={testing === "llm"}
            >
              {testing === "llm" ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  <FormattedMessage id="settings.testing" />
                </>
              ) : (
                <FormattedMessage id="settings.test" />
              )}
            </Button>
          </SettingsRow>
          <TestStatus state={state} />
        </div>
      )}

      {pick === "demo" && (
        <div className="border-t border-border pt-4">
          <SettingsRow
            title={intl.formatMessage({ id: "settings.ai.test" })}
            description={intl.formatMessage({ id: "settings.ai.testDesc" })}
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void runTest("llm")}
              disabled={testing === "llm"}
              aria-busy={testing === "llm"}
            >
              {testing === "llm" ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  <FormattedMessage id="settings.testing" />
                </>
              ) : (
                <FormattedMessage id="settings.test" />
              )}
            </Button>
          </SettingsRow>
          <TestStatus state={state} />
        </div>
      )}
    </div>
  );
}

function TestStatus(props: { state?: { status: string; message?: string } }) {
  if (!props.state || (props.state.status !== "ok" && props.state.status !== "err")) return null;
  return (
    <span
      role="status"
      className={
        "flex items-center gap-1 text-xs " +
        (props.state.status === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600")
      }
    >
      {props.state.status === "ok" ? (
        <Check className="size-3.5" aria-hidden="true" />
      ) : (
        <X className="size-3.5" aria-hidden="true" />
      )}
      {props.state.status === "ok" ? (
        <>
          <FormattedMessage id="settings.testOk" />
          {props.state.message ? `: ${props.state.message}` : ""}
        </>
      ) : (
        <FormattedMessage
          id="settings.testFailed"
          values={{ message: props.state.message ?? "" }}
        />
      )}
    </span>
  );
}
