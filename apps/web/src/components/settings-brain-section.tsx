import * as React from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";

import { SettingsRow } from "./settings-row";
import { Textarea } from "./vendor/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./vendor/select";
import { Button } from "./vendor/button";
import { Alert, AlertDescription } from "./vendor/alert";
import { EndpointFields } from "./endpoint-fields";
import { sectionIncomplete, useModelOptions, useSettingsDrafts } from "./settings-drafts";
import { $providerProfile } from "../lib/runtime";
import { useSsrStore } from "../lib/ssr";
import { DEMO_LLM, DEMO_LLM_ENABLED, isDemoLlm } from "../lib/demo-llm";
import { createOpenAiCompatibleModel } from "../lib/agent/openai-compatible-provider";
import { TRANSFORMERS_CATALOG } from "../lib/agent/browser-provider";
import { errorDetail } from "../lib/errors";
import { markSeamOp } from "../lib/seam-health";

type LlmPick = "in-browser" | "demo" | "cloud";

interface TestState {
  status: "idle" | "running" | "ok" | "err";
  message?: string;
}

/**
 * Brain: the interviewer llm layer select (in-browser scaffold marked
 * coming soon, managed demo, or a BYO cloud endpoint) with its conditional
 * config, then the test row firing a real short completion into a
 * read-only transcript area.
 */
export function BrainSection() {
  const intl = useIntl();
  const profile = useSsrStore($providerProfile, null);
  const { drafts, update } = useSettingsDrafts();
  const draft = drafts.llm;
  const modelOptions = useModelOptions(draft);

  // demo is the default: an untouched draft (nothing configured) selects it
  const pick: LlmPick =
    draft.llmMode === "browser"
      ? "in-browser"
      : isDemoLlm(draft.baseUrl) || (!draft.enabled && !draft.baseUrl)
        ? "demo"
        : "cloud";

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
    } else if (next === "cloud") {
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

  const [test, setTest] = React.useState<TestState>({ status: "idle" });
  const [output, setOutput] = React.useState("");

  /** fire one real short completion through the configured llm, streamed */
  async function runTest() {
    setTest({ status: "running" });
    setOutput("");
    try {
      const model = createOpenAiCompatibleModel(
        { baseUrl: draft.baseUrl, apiKey: draft.apiKey, model: draft.model },
        {},
      );
      const { streamText } = await import("ai");
      const { textStream } = streamText({
        model,
        prompt: "Reply with the single word: ok",
        maxOutputTokens: 5,
      });
      let text = "";
      for await (const delta of textStream) {
        text += delta;
        setOutput(text);
      }
      if (text.trim()) {
        setTest({ status: "ok" });
        markSeamOp("llm", true);
      } else {
        setTest({ status: "err", message: intl.formatMessage({ id: "settings.invalid" }) });
        markSeamOp("llm", false, "settings.invalid");
      }
    } catch (err) {
      const msg = errorDetail(intl, err);
      setTest({ status: "err", message: msg });
      markSeamOp("llm", false, msg);
    }
  }

  const incomplete = pick === "cloud" && sectionIncomplete("llm", draft);
  const testable = pick !== "in-browser";

  return (
    <div className="space-y-1">
      <SettingsRow
        title={intl.formatMessage({ id: "settings.layer.llm" })}
        description={intl.formatMessage({ id: "settings.layer.llmDesc" })}
      >
        <Select value={pick} onValueChange={choose}>
          <SelectTrigger
            size="sm"
            className="w-44"
            aria-label={intl.formatMessage({ id: "settings.layer.llm" })}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="in-browser" disabled>
              {intl.formatMessage({ id: "settings.layer.inBrowser" })}
              {" — "}
              {intl.formatMessage({ id: "settings.layer.comingSoon" })}
            </SelectItem>
            <SelectItem value="demo" disabled={!DEMO_LLM_ENABLED}>
              {intl.formatMessage({ id: "settings.ai.demo" })}
            </SelectItem>
            <SelectItem value="cloud">
              {intl.formatMessage({ id: "settings.layer.cloud" })}
            </SelectItem>
          </SelectContent>
        </Select>
      </SettingsRow>

      {pick === "in-browser" && (
        <div className="space-y-1.5 pb-3 pl-1" aria-disabled="true">
          <p className="text-xs text-muted-foreground">
            <FormattedMessage id="settings.llm.comingSoonDesc" />
          </p>
          {["gemini nano (chrome)", ...TRANSFORMERS_CATALOG.map((e) => e.label)].map((label) => (
            <div key={label} className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="min-w-0 flex-1 truncate">{label}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                <FormattedMessage id="settings.layer.comingSoon" />
              </span>
            </div>
          ))}
        </div>
      )}

      {pick === "demo" && (
        <div className="pb-3 pl-1">
          <p className="rounded-lg bg-sage/10 p-3 text-xs text-muted-foreground">
            <FormattedMessage id="settings.ai.demoLimits" />
          </p>
        </div>
      )}

      {pick === "cloud" && (
        <div className="space-y-4 pb-3 pl-1">
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
            savedApiKey={profile?.llm && "apiKey" in profile.llm ? profile.llm.apiKey : null}
            modelOptions={modelOptions}
            onChange={(patch) => update("llm", { enabled: true, ...patch })}
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
        </div>
      )}

      <SettingsRow
        title={intl.formatMessage({ id: "settings.test" })}
        description={intl.formatMessage({ id: "settings.ai.testDesc" })}
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void runTest()}
          disabled={!testable || test.status === "running" || incomplete}
          aria-busy={test.status === "running"}
        >
          {test.status === "running" ? (
            <>
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              <FormattedMessage id="settings.testing" />
            </>
          ) : (
            <FormattedMessage id="settings.ai.test" />
          )}
        </Button>
      </SettingsRow>
      {(test.status === "running" || output) && (
        <div className="space-y-2 pb-2 pl-1">
          <Textarea
            readOnly
            value={output}
            placeholder={intl.formatMessage({ id: "settings.llm.outputPlaceholder" })}
            rows={2}
            className="resize-none bg-white text-sm"
            aria-label={intl.formatMessage({ id: "settings.layer.llm" })}
          />
        </div>
      )}
      {test.status === "ok" || test.status === "err" ? (
        <span
          role="status"
          className={
            "flex items-center gap-1 pb-2 pl-1 text-xs " +
            (test.status === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600")
          }
        >
          {test.status === "ok" ? (
            <Check className="size-3.5" aria-hidden="true" />
          ) : (
            <X className="size-3.5" aria-hidden="true" />
          )}
          {test.status === "ok" ? (
            <FormattedMessage id="settings.testOk" />
          ) : (
            <FormattedMessage id="settings.testFailed" values={{ message: test.message ?? "" }} />
          )}
        </span>
      ) : null}
    </div>
  );
}
