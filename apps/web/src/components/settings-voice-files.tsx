import * as React from "react";
import { useStore } from "@nanostores/react";
import { FormattedMessage, useIntl } from "react-intl";
import { Download, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "./vendor/button";
import { Progress } from "./vendor/progress";
import { $voiceDownload, $voiceModelsConsent } from "../stores/voice";
import { codeMessage } from "../lib/errors";
import {
  DEFAULT_VOICE_MODEL_MANIFEST,
  clearVoiceModels,
  downloadVoiceModels,
  voiceModelBytesInstalled,
  wasmVoiceSupported,
} from "../lib/voice/models";

function fmtMb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

/**
 * The on-device voice pack file management (download / progress / delete)
 * shown inside a wasm layer conditional — the same controls the old
 * downloads pane rendered, inlined where the layer is configured.
 */
export function VoicePackFiles() {
  const intl = useIntl();
  const download = useStore($voiceDownload);
  const supported = React.useMemo(() => wasmVoiceSupported(), []);
  const [installed, setInstalled] = React.useState<{ stt: boolean; tts: boolean } | null>(null);

  const refresh = React.useCallback(async () => {
    setInstalled(await voiceModelBytesInstalled());
  }, []);
  React.useEffect(() => {
    void refresh();
  }, [refresh, download.status]);

  const startDownload = () => {
    // picking wasm implies consent to download the pack (the consent dialog
    // still owns the first grant elsewhere)
    $voiceModelsConsent.set("granted");
    void downloadVoiceModels()
      .then(refresh)
      .catch(() => toast.error(intl.formatMessage({ id: "settings.voicePane.downloadFailed" })));
  };

  const ready = installed?.stt && installed?.tts;
  const downloading = download.status === "downloading";
  const sizeMb = fmtMb(
    Object.values(DEFAULT_VOICE_MODEL_MANIFEST.models).reduce(
      (sum, entry) => sum + entry.files.reduce((s, f) => s + f.size, 0),
      0,
    ),
  );

  const status = downloading
    ? intl.formatMessage(
        { id: "settings.voicePane.downloading" },
        {
          percent: Math.round(download.progress * 100),
          done: fmtMb(download.bytesDone),
          total: fmtMb(download.bytesTotal),
        },
      )
    : ready
      ? intl.formatMessage({ id: "settings.downloads.installedSize" }, { size: sizeMb })
      : download.status === "error"
        ? intl.formatMessage(
            { id: "settings.voicePane.error" },
            { message: codeMessage(intl, download.error) },
          )
        : intl.formatMessage({ id: "settings.voicePane.notInstalled" });

  return (
    <div className="space-y-2 pl-1">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={downloading || !supported}
          onClick={startDownload}
          aria-busy={downloading}
        >
          {ready ? (
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
          disabled={downloading || !(installed?.stt || installed?.tts)}
          onClick={() => void clearVoiceModels().then(refresh)}
          aria-label={intl.formatMessage({ id: "settings.downloads.remove" })}
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
        </Button>
        <span className="text-xs text-muted-foreground">
          <FormattedMessage id="settings.voicePack.size" values={{ size: sizeMb }} />
          {" · "}
          {status}
        </span>
      </div>
      {downloading && (
        <Progress value={download.progress * 100} className="w-[calc(100%-0.5rem)]" />
      )}
      {!supported && (
        <p role="note" className="text-xs text-persimmon-deep">
          <FormattedMessage id="settings.voicePane.unsupported" />
        </p>
      )}
    </div>
  );
}
