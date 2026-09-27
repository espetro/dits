import * as React from "react";
import { useStore } from "@nanostores/react";
import { FormattedMessage, useIntl } from "react-intl";
import { Download, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { SettingsRow } from "./settings-row";
import { Button } from "./vendor/button";
import { Progress } from "./vendor/progress";
import { Separator } from "./vendor/separator";
import { $voiceDownload, $voiceModelsConsent } from "../stores/voice";
import { codeMessage } from "../lib/errors";
import {
  DEFAULT_VOICE_MODEL_MANIFEST,
  clearVoiceModels,
  downloadVoiceModels,
  voiceModelBytesInstalled,
  wasmVoiceSupported,
} from "../lib/voice/models";
import {
  TRANSFORMERS_CATALOG,
  deleteAllTransformersModels,
  deleteTransformersModel,
  smokeTestModel,
  transformersModelInstalled,
} from "../lib/agent/browser-provider";
import { MODEL_DOWNLOAD_TIMEOUT_MS } from "../lib/timeouts";

function fmtMb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

/**
 * Settings -> downloads: every model cache in one place — the on-device
 * voice bundle (stt + tts wasm) and each in-browser llm — with status,
 * size, re-download and remove controls.
 */
export function DownloadsPane() {
  const intl = useIntl();
  const download = useStore($voiceDownload);
  const supported = React.useMemo(() => wasmVoiceSupported(), []);

  const [voiceInstalled, setVoiceInstalled] = React.useState<{
    stt: boolean;
    tts: boolean;
  } | null>(null);
  const [llmInstalled, setLlmInstalled] = React.useState<Record<string, boolean>>({});
  const [llmBusy, setLlmBusy] = React.useState<string | null>(null);
  const [geminiInstalled, setGeminiInstalled] = React.useState<boolean | null>(null);

  const refresh = React.useCallback(async () => {
    setVoiceInstalled(await voiceModelBytesInstalled());
    setGeminiInstalled("LanguageModel" in globalThis);
    const next: Record<string, boolean> = {};
    for (const entry of TRANSFORMERS_CATALOG) {
      next[entry.id] = await transformersModelInstalled(entry.id);
    }
    setLlmInstalled(next);
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh, download.status]);

  const startVoiceDownload = () => {
    $voiceModelsConsent.set("granted");
    void downloadVoiceModels()
      .then(refresh)
      .catch(() => toast.error(intl.formatMessage({ id: "settings.voicePane.downloadFailed" })));
  };

  async function downloadLlm(modelId: string) {
    setLlmBusy(modelId);
    try {
      await smokeTestModel(
        { mode: "browser", engine: "transformers", modelId },
        { timeoutMs: MODEL_DOWNLOAD_TIMEOUT_MS },
      );
      await refresh();
    } finally {
      setLlmBusy(null);
    }
  }

  const voiceReady = voiceInstalled?.stt && voiceInstalled?.tts;
  const downloading = download.status === "downloading";
  const voiceSizeMb = fmtMb(
    Object.values(DEFAULT_VOICE_MODEL_MANIFEST.models).reduce(
      (sum, entry) => sum + entry.files.reduce((s, f) => s + f.size, 0),
      0,
    ),
  );

  const voiceStatus = downloading
    ? intl.formatMessage(
        { id: "settings.voicePane.downloading" },
        {
          percent: Math.round(download.progress * 100),
          done: fmtMb(download.bytesDone),
          total: fmtMb(download.bytesTotal),
        },
      )
    : voiceReady
      ? intl.formatMessage({ id: "settings.downloads.installedSize" }, { size: voiceSizeMb })
      : download.status === "error"
        ? intl.formatMessage(
            { id: "settings.voicePane.error" },
            { message: codeMessage(intl, download.error) },
          )
        : intl.formatMessage({ id: "settings.voicePane.notInstalled" });

  return (
    <div className="space-y-1">
      <p className="pb-3 text-xs text-muted-foreground">
        <FormattedMessage id="settings.downloads.intro" />
      </p>

      <SettingsRow
        title={intl.formatMessage({ id: "settings.downloads.voice" })}
        description={intl.formatMessage(
          { id: "settings.downloads.voiceDesc" },
          { size: voiceSizeMb, status: voiceStatus },
        )}
      >
        <span className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={downloading || !supported}
            onClick={startVoiceDownload}
            aria-busy={downloading}
          >
            {voiceReady ? (
              <>
                <RefreshCw className="size-3.5" aria-hidden="true" />
                <FormattedMessage id="settings.voicePane.redownload" />
              </>
            ) : (
              <>
                <Download className="size-3.5" aria-hidden="true" />
                <FormattedMessage id="settings.voicePane.download" />
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={downloading || !(voiceInstalled?.stt || voiceInstalled?.tts)}
            onClick={() => void clearVoiceModels().then(refresh)}
            aria-label={intl.formatMessage({ id: "settings.downloads.remove" })}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
          </Button>
        </span>
      </SettingsRow>
      {downloading && (
        <Progress value={download.progress * 100} className="mx-1 mb-3 w-[calc(100%-0.5rem)]" />
      )}
      {!supported && (
        <p role="note" className="pb-3 pl-1 text-xs text-muted-foreground">
          <FormattedMessage id="settings.voicePane.unsupported" />
        </p>
      )}

      <Separator className="my-4" />
      <p className="pb-2 pl-1 text-xs font-medium text-muted-foreground">
        <FormattedMessage id="settings.downloads.llm" />
      </p>

      <SettingsRow
        title={intl.formatMessage({ id: "settings.llm.engineGemini" })}
        description={intl.formatMessage({
          id: geminiInstalled ? "settings.llm.geminiReady" : "settings.llm.geminiUnavailable",
        })}
      />

      {TRANSFORMERS_CATALOG.map((entry) => {
        const isInstalled = llmInstalled[entry.id] ?? false;
        const busy = llmBusy === entry.id;
        return (
          <SettingsRow
            key={entry.id}
            title={entry.label}
            description={intl.formatMessage(
              {
                id: isInstalled
                  ? "settings.downloads.llmInstalled"
                  : "settings.downloads.llmNotInstalled",
              },
              { size: entry.sizeMb },
            )}
          >
            <span className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={llmBusy !== null}
                onClick={() => void downloadLlm(entry.id)}
                aria-busy={busy}
              >
                {isInstalled ? (
                  <>
                    <RefreshCw className="size-3.5" aria-hidden="true" />
                    <FormattedMessage id="settings.llm.reDownload" />
                  </>
                ) : (
                  <>
                    <Download className="size-3.5" aria-hidden="true" />
                    <FormattedMessage id="settings.llm.download" />
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={llmBusy !== null || !isInstalled}
                onClick={() =>
                  void deleteTransformersModel(entry.id)
                    .then(refresh)
                    .catch(() => undefined)
                }
                aria-label={intl.formatMessage({ id: "settings.downloads.remove" })}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </Button>
            </span>
          </SettingsRow>
        );
      })}

      <div className="pt-3 pl-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={llmBusy !== null || !Object.values(llmInstalled).some(Boolean)}
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
  );
}
