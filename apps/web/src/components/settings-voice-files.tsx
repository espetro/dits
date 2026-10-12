import * as React from "react";
import { atom } from "nanostores";
import { useStore } from "@nanostores/react";
import { FormattedMessage, useIntl } from "react-intl";
import { Download, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "./vendor/button";
import { Progress } from "./vendor/progress";
import { $voiceDownload, $voiceModelsConsent, $voiceModelsInstalled } from "../stores/voice";
import { codeMessage } from "../lib/errors";
import {
  DEFAULT_VOICE_MODEL_MANIFEST,
  clearVoiceModels,
  downloadVoiceModels,
  refreshVoiceModelsInstalled,
  wasmVoiceSupported,
} from "../lib/voice/models";

function fmtMb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

interface ServerModelsStatus {
  providers: { stt: "remote" | "builtin"; tts: "remote" | "builtin" };
  models: Record<
    "stt" | "tts",
    { installed: boolean; bytes_installed: number; bytes_total: number }
  >;
  dir: string;
  download: { path: string; bytes_done: number; bytes_total: number } | null;
}

const API_BASE = (import.meta.env.VITE_DI_API_BASE as string | undefined) ?? "";

async function serverModelsStatus(): Promise<ServerModelsStatus | null> {
  try {
    const res = await fetch(`${API_BASE}/v1/voice/models`);
    if (!res.ok) return null;
    return (await res.json()) as ServerModelsStatus;
  } catch {
    return null;
  }
}

/**
 * Shared copy of the server status: both ServerPackFiles rows (stt +
 * tts) describe the SAME files.data_dir/models cache, so a mutation in
 * one row must refresh the other — a per-instance fetch would leave the
 * sibling showing bytes the other just deleted.
 */
const $serverModels = atom<ServerModelsStatus | null>(null);

async function refreshServerModels(): Promise<void> {
  $serverModels.set(await serverModelsStatus());
}

/**
 * Server-side builtin model pack row (the files.data_dir/models cache),
 * mirroring VoicePackFiles for the di-server stt/tts layers.
 * Renders nothing when the server is unreachable, the layer's provider
 * isn't builtin, or the layer is neither active nor holding cached files.
 */
function ServerPackFiles(props: { kind: "stt" | "tts"; active: boolean }) {
  const intl = useIntl();
  const status = useStore($serverModels);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    void refreshServerModels();
  }, []);

  // poll while a pull is in flight (progress arrives via GET) or our own
  // POST is parked server-side waiting for the download to finish
  const downloading = status?.download != null;
  React.useEffect(() => {
    if (!downloading && !busy) return;
    const t = setInterval(() => void refreshServerModels(), 1000);
    return () => clearInterval(t);
  }, [downloading, busy]);

  const act = React.useCallback(
    async (method: "POST" | "DELETE") => {
      setBusy(true);
      try {
        const res = await fetch(`${API_BASE}/v1/voice/models${method === "POST" ? "/pull" : ""}`, {
          method,
        });
        if (!res.ok) throw new Error(`${res.status}`);
        $serverModels.set((await res.json()) as ServerModelsStatus);
      } catch {
        toast.error(intl.formatMessage({ id: "settings.voicePane.downloadFailed" }));
      } finally {
        setBusy(false);
      }
    },
    [intl],
  );

  if (!status || status.providers[props.kind] !== "builtin") return null;
  const entry = status.models[props.kind];
  if (!props.active && entry.bytes_installed === 0) return null;
  const dl = status.download;

  const text = dl
    ? intl.formatMessage(
        { id: "settings.voicePane.downloading" },
        {
          percent: Math.round((dl.bytes_done / Math.max(1, dl.bytes_total)) * 100),
          done: fmtMb(dl.bytes_done),
          total: fmtMb(dl.bytes_total),
        },
      )
    : entry.installed
      ? intl.formatMessage(
          { id: "settings.voicePack.size" },
          { size: fmtMb(entry.bytes_installed) },
        )
      : intl.formatMessage({ id: "settings.voicePane.notInstalled" });

  return (
    <div className="space-y-2 pl-1">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || downloading}
          onClick={() => void act("POST")}
          aria-busy={busy || downloading}
        >
          {entry.installed ? (
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
          disabled={busy || downloading || entry.bytes_installed === 0}
          onClick={() => void act("DELETE")}
          aria-label={intl.formatMessage({ id: "settings.downloads.remove" })}
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
        </Button>
        <span className="text-xs text-muted-foreground" title={status.dir}>
          <FormattedMessage id="settings.serverPack.label" values={{ kind: props.kind }} />
          {" · "}
          {text}
        </span>
      </div>
      {dl && (
        <Progress
          value={(dl.bytes_done / Math.max(1, dl.bytes_total)) * 100}
          className="w-[calc(100%-0.5rem)]"
        />
      )}
    </div>
  );
}

/**
 * The single voice-model management surface for a layer: one block that
 * lists a row per model cache in play — "on this device" (browser
 * CacheStorage/OPFS, the wasm pick) and/or "di server" (the binary's
 * files.data_dir cache, the server pick / auto-driven builtin). A row
 * also stays visible while its cache holds files, so a stale cache left
 * behind by a pick switch remains removable.
 */
export function ModelPackFiles(props: {
  kind: "stt" | "tts";
  /** the layer's engine pick resolves to browser-side wasm */
  device: boolean;
  /** the layer's engine pick resolves to the di server */
  server: boolean;
}) {
  const installed = useStore($voiceModelsInstalled);
  const showDevice = props.device || installed?.[props.kind] === true;
  // ServerPackFiles always mounts: it self-hides unless the provider is
  // builtin AND (active pick or non-empty cache), which also covers a
  // stale server cache after a pick switch.
  return (
    <div className="space-y-2 pl-1">
      {showDevice && <VoicePackFiles />}
      <ServerPackFiles kind={props.kind} active={props.server} />
    </div>
  );
}

/**
 * The on-device voice pack file management (download / progress / delete)
 * shown inside a wasm layer conditional — the same controls the old
 * downloads pane rendered, inlined where the layer is configured.
 */
function VoicePackFiles() {
  const intl = useIntl();
  const download = useStore($voiceDownload);
  const consent = useStore($voiceModelsConsent);
  const supported = React.useMemo(() => wasmVoiceSupported(), []);
  // the shared installed flag (persisted + cache-re-verified) — the same
  // verdict the seam chip reads, so the pane and the chip can't disagree
  const installed = useStore($voiceModelsInstalled);

  const refresh = React.useCallback(() => refreshVoiceModelsInstalled(), []);
  React.useEffect(() => {
    void refresh();
  }, [refresh, download.status]);

  const startDownload = React.useCallback(() => {
    // picking wasm implies consent to download the pack (the consent dialog
    // still owns the first grant elsewhere)
    $voiceModelsConsent.set("granted");
    void downloadVoiceModels()
      .then(refresh)
      .catch(() => toast.error(intl.formatMessage({ id: "settings.voicePane.downloadFailed" })));
  }, [intl, refresh]);

  React.useEffect(() => {
    // a wasm pick with consent already granted is a standing request for
    // the pack: fetch it without waiting for a second click. errors stay
    // manual (status "error") so a failed run doesn't loop.
    if (
      supported &&
      installed !== null &&
      (!installed.stt || !installed.tts) &&
      consent === "granted" &&
      download.status === "idle"
    ) {
      startDownload();
    }
  }, [supported, installed, consent, download.status, startDownload]);

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
