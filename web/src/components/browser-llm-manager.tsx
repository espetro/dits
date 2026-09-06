import * as React from "react";
import { FormattedMessage, useIntl } from "react-intl";
import type { BrowserLlmSection } from "@di/shared";
import {
  DEFAULT_TRANSFORMERS_MODEL_ID,
  TRANSFORMERS_CATALOG,
  deleteAllTransformersModels,
  deleteTransformersModel,
  smokeTestModel,
  transformersModelInstalled,
  type BrowserModelStatus,
} from "../lib/agent/browser-provider";
import { Button } from "./vendor/button";

const fieldClass = "block text-xs text-muted-foreground";

/** Status dot color for a browser model status. */
function statusDotClass(state: BrowserModelStatus["state"]): string {
  switch (state) {
    case "available":
      return "bg-emerald-500";
    case "installed":
      return "bg-sky-500";
    case "downloadable":
      return "bg-amber-500";
    case "unsupported":
      return "bg-red-500";
  }
}

/**
 * In-browser LLM manager: engine picker, Gemini Nano availability row, and
 * the transformers.js model list (size, installed state, download progress,
 * delete / remove-all). Extracted from settings-dialog to keep that file
 * under the loc ratchet.
 */
export function BrowserLlmManager(props: {
  engine: BrowserLlmSection["engine"];
  modelId: string;
  onEngineChange: (engine: BrowserLlmSection["engine"]) => void;
  onModelIdChange: (modelId: string) => void;
}) {
  const intl = useIntl();
  const [geminiStatus, setGeminiStatus] = React.useState<BrowserModelStatus | null>(null);
  const [installed, setInstalled] = React.useState<Record<string, boolean>>({});
  const [progress, setProgress] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);

  const refresh = React.useCallback(async () => {
    const gemini = "LanguageModel" in globalThis;
    setGeminiStatus(
      gemini ? { state: "installed", detail: "prompt-api" } : { state: "unsupported" },
    );
    const next: Record<string, boolean> = {};
    for (const entry of TRANSFORMERS_CATALOG) {
      next[entry.id] = await transformersModelInstalled(entry.id);
    }
    setInstalled(next);
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  async function download(modelId: string) {
    setBusy(true);
    setProgress(0);
    try {
      const section: BrowserLlmSection =
        props.engine === "transformers"
          ? { mode: "browser", engine: "transformers", modelId }
          : { mode: "browser", engine: "gemini-nano" };
      // loading IS the download for both engines (create monitors progress);
      // a tiny smoke prompt confirms the weights actually work.
      if (section.engine === "transformers") {
        const { TransformersJSLanguageModel } = await import("@browser-ai/transformers-js");
        // weights are fetched here; progress surfaces via smokeTestModel load
        void TransformersJSLanguageModel;
      }
      await smokeTestModel(section);
      await refresh();
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const geminiUnsupported = geminiStatus?.state === "unsupported";
  const selectedId = props.modelId || DEFAULT_TRANSFORMERS_MODEL_ID;

  return (
    <div className="space-y-4 rounded-lg bg-muted/40 p-3">
      <div className="space-y-1.5">
        <span className={fieldClass}>
          <FormattedMessage id="settings.llm.browserEngine" />
        </span>
        <select
          value={props.engine}
          onChange={(e) => props.onEngineChange(e.target.value as BrowserLlmSection["engine"])}
          className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-persimmon/50"
        >
          <option value="gemini-nano">
            {intl.formatMessage({ id: "settings.llm.engineGemini" })}
          </option>
          <option value="transformers">
            {intl.formatMessage({ id: "settings.llm.engineTransformers" })}
          </option>
        </select>
      </div>

      {props.engine === "gemini-nano" ? (
        <div className="flex items-center gap-2 text-xs">
          <span
            role="img"
            aria-label={intl.formatMessage({ id: "settings.llm.statusDot" })}
            className={`inline-block size-2 rounded-full ${statusDotClass(geminiStatus?.state ?? "downloadable")}`}
          />
          {geminiUnsupported ? (
            <span className="text-muted-foreground">
              <FormattedMessage id="settings.llm.geminiUnavailable" />
            </span>
          ) : (
            <span className="text-muted-foreground">
              <FormattedMessage id="settings.llm.geminiReady" />
            </span>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <span className={fieldClass}>
            <FormattedMessage id="settings.llm.browserModel" />
          </span>
          <div className="space-y-1.5">
            {TRANSFORMERS_CATALOG.map((entry) => {
              const isInstalled = installed[entry.id] ?? false;
              const isSelected = selectedId === entry.id;
              return (
                <label
                  key={entry.id}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-xs ${
                    isSelected ? "border-persimmon/60 bg-background" : "border-border bg-background"
                  }`}
                >
                  <input
                    type="radio"
                    name="browser-llm-model"
                    className="accent-persimmon"
                    checked={isSelected}
                    onChange={() => props.onModelIdChange(entry.id)}
                  />
                  <span className="flex-1">
                    <span className="font-medium">{entry.label}</span>
                    <span className="ml-2 text-muted-foreground">~{entry.sizeMb} MB</span>
                    {isInstalled && (
                      <span className="ml-2 text-emerald-600 dark:text-emerald-400">
                        <FormattedMessage id="settings.llm.installed" />
                      </span>
                    )}
                  </span>
                  {isSelected && isInstalled && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={(e) => {
                        e.preventDefault();
                        void deleteTransformersModel(entry.id).then(refresh);
                      }}
                    >
                      <FormattedMessage id="settings.llm.delete" />
                    </Button>
                  )}
                </label>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {progress !== null ? (
              <span className="text-xs text-muted-foreground">
                <FormattedMessage
                  id="settings.llm.downloading"
                  values={{ percent: Math.round(progress * 100) }}
                />
              </span>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || installed[selectedId]}
                onClick={() => void download(selectedId)}
              >
                {installed[selectedId] ? (
                  <FormattedMessage id="settings.llm.reDownload" />
                ) : (
                  <FormattedMessage id="settings.llm.download" />
                )}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() =>
                void deleteAllTransformersModels()
                  .then(refresh)
                  .catch(() => undefined)
              }
            >
              <FormattedMessage id="settings.llm.removeAll" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
