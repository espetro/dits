import * as React from "react";
import { useStore } from "@nanostores/react";
import { FormattedMessage, useIntl } from "react-intl";
import { Download, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./vendor/button";
import { Label } from "./vendor/label";
import { RadioGroup, RadioGroupItem } from "./vendor/radio-group";
import { $providerProfile } from "../lib/runtime";
import { useSsrStore } from "../lib/ssr";
import {
  $voiceDownload,
  $voiceModelsConsent,
  $voiceSttEngine,
  $voiceTtsEngine,
} from "../stores/voice";
import type { SttEnginePick, TtsEnginePick } from "../stores/voice";
import {
  DEFAULT_VOICE_MODEL_MANIFEST,
  clearVoiceModels,
  downloadVoiceModels,
  voiceModelBytesInstalled,
  wasmVoiceSupported,
} from "../lib/voice/models";

const fieldClass = "block text-xs text-muted-foreground";

function fmtMb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

/**
 * Settings -> voice: per-engine pickers (on-device wasm vs built-in vs tts
 * custom endpoint) plus the model cache controls (state line, re-download,
 * clear cache). Picking an on-device engine after declining consent
 * re-arms the download — the consent prompt itself is never re-shown.
 */
export function VoiceEnginesPane() {
  const intl = useIntl();
  const sttPick = useStore($voiceSttEngine);
  const ttsPick = useStore($voiceTtsEngine);
  const consent = useStore($voiceModelsConsent);
  const download = useStore($voiceDownload);
  const profile = useSsrStore($providerProfile, null);
  const hasTtsEndpoint = profile?.tts !== undefined;
  const supported = React.useMemo(() => wasmVoiceSupported(), []);

  const [installed, setInstalled] = React.useState<{ stt: boolean; tts: boolean } | null>(null);
  const refresh = React.useCallback(async () => {
    setInstalled(await voiceModelBytesInstalled());
  }, []);
  React.useEffect(() => {
    void refresh();
  }, [refresh, download.status]);

  const startDownload = () => {
    $voiceModelsConsent.set("granted");
    void downloadVoiceModels()
      .then(refresh)
      .catch(() => toast.error(intl.formatMessage({ id: "settings.voicePane.downloadFailed" })));
  };

  const pickStt = (value: string) => {
    const pick = value as SttEnginePick;
    $voiceSttEngine.set(pick);
    if (pick === "on-device" && supported && !(installed?.stt ?? false)) startDownload();
  };
  const pickTts = (value: string) => {
    const pick = value as TtsEnginePick;
    $voiceTtsEngine.set(pick);
    if (pick === "on-device" && supported && !(installed?.tts ?? false)) startDownload();
  };

  const sttOptions = (
    <>
      <Label className="flex items-center gap-1.5 text-sm font-normal">
        <RadioGroupItem value="on-device" />
        <FormattedMessage id="settings.voicePane.onDevice" />
      </Label>
      <Label className="flex items-center gap-1.5 text-sm font-normal">
        <RadioGroupItem value="builtin" />
        <FormattedMessage id="settings.voicePane.builtin" />
      </Label>
    </>
  );

  const downloading = download.status === "downloading";

  return (
    <div className="space-y-5">
      {!supported && (
        <p role="note" className="text-xs text-persimmon-deep">
          <FormattedMessage id="settings.voicePane.unsupported" />
        </p>
      )}
      {consent === "declined" && supported && (
        <p role="note" className="text-xs text-muted-foreground">
          <FormattedMessage id="settings.voicePane.consentDeclinedHint" />
        </p>
      )}

      <div className="space-y-1.5">
        <span className={fieldClass}>
          <FormattedMessage id="settings.voicePane.stt" />
        </span>
        <RadioGroup
          value={sttPick}
          onValueChange={pickStt}
          className="flex flex-wrap gap-4"
          aria-label={intl.formatMessage({ id: "settings.voicePane.stt" })}
        >
          {sttOptions}
        </RadioGroup>
      </div>

      <div className="space-y-1.5">
        <span className={fieldClass}>
          <FormattedMessage id="settings.voicePane.tts" />
        </span>
        <RadioGroup
          value={ttsPick === "" ? (hasTtsEndpoint ? "endpoint" : "on-device") : ttsPick}
          onValueChange={pickTts}
          className="flex flex-wrap gap-4"
          aria-label={intl.formatMessage({ id: "settings.voicePane.tts" })}
        >
          {sttOptions}
          {hasTtsEndpoint && (
            <Label className="flex items-center gap-1.5 text-sm font-normal">
              <RadioGroupItem value="endpoint" />
              <FormattedMessage id="settings.voicePane.customEndpoint" />
            </Label>
          )}
        </RadioGroup>
      </div>

      <div className="space-y-2 rounded-xl border border-border p-4">
        <span className={fieldClass}>
          <FormattedMessage id="settings.voicePane.models" />
        </span>
        <div className="flex items-center gap-2 text-sm">
          <span
            className={
              "size-2 rounded-full " +
              (installed?.stt && installed?.tts
                ? "bg-sky-500"
                : downloading
                  ? "bg-amber-500"
                  : download.status === "error"
                    ? "bg-red-500"
                    : "bg-muted-foreground/40")
            }
            aria-hidden="true"
          />
          <span className="text-muted-foreground">
            {downloading ? (
              <FormattedMessage
                id="settings.voicePane.downloading"
                values={{
                  percent: Math.round(download.progress * 100),
                  done: fmtMb(download.bytesDone),
                  total: fmtMb(download.bytesTotal),
                }}
              />
            ) : installed?.stt && installed?.tts ? (
              <FormattedMessage
                id="settings.voicePane.installed"
                values={{
                  total: fmtMb(
                    Object.values(DEFAULT_VOICE_MODEL_MANIFEST.models).reduce(
                      (sum, entry) => sum + entry.files.reduce((s, f) => s + f.size, 0),
                      0,
                    ),
                  ),
                }}
              />
            ) : download.status === "error" ? (
              <FormattedMessage
                id="settings.voicePane.error"
                values={{ message: download.error ?? "" }}
              />
            ) : (
              <FormattedMessage id="settings.voicePane.notInstalled" />
            )}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={downloading || !supported}
            onClick={startDownload}
            aria-busy={downloading}
          >
            {installed?.stt && installed?.tts ? (
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
            variant="outline"
            size="sm"
            disabled={downloading || !(installed?.stt || installed?.tts)}
            onClick={() => void clearVoiceModels().then(refresh)}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            <FormattedMessage id="settings.voicePane.clear" />
          </Button>
        </div>
      </div>
    </div>
  );
}
