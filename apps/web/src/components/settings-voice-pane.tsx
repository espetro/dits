import * as React from "react";
import { useStore } from "@nanostores/react";
import { FormattedMessage, useIntl } from "react-intl";
import { Check, ChevronRight, Loader2, X } from "lucide-react";

import { SettingsRow } from "./settings-row";
import { MicSelector } from "./mic-selector";
import { Textarea } from "./vendor/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./vendor/select";
import { Button } from "./vendor/button";
import { openSettings } from "./settings-nav";
import { $providerProfile } from "../lib/runtime";
import { useSsrStore } from "../lib/ssr";
import { $micDeviceId } from "../stores/devices";
import {
  $voiceDownload,
  $voiceModelsConsent,
  $voiceSttEngine,
  $voiceTtsEngine,
  requestVoiceConsent,
} from "../stores/voice";
import type { SttEnginePick, TtsEnginePick } from "../stores/voice";
import {
  DEFAULT_VOICE_MODEL_MANIFEST,
  downloadVoiceModels,
  voiceModelBytesInstalled,
  wasmVoiceSupported,
} from "../lib/voice/models";
import { resolveInstalledVoiceEngines } from "../lib/voice/engines";
import { synthesizeSpeech } from "../lib/agent/tts";
import { hasBrowserStt, startLiveStt, testBrowserTts } from "../lib/settings-tests";
import { DiError, codeMessage, errorDetail } from "../lib/errors";
import { toast } from "sonner";

function fmtMb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

interface VoiceTestState {
  status: "idle" | "running" | "ok" | "err";
  message?: string;
}

/**
 * Settings -> voice & microphone: the mic picker, the two engine rows
 * ("understands you with" / "answers you with"), a models status row that
 * links to downloads, and the test call. Picking an on-device engine while
 * unconsented re-arms the consent prompt — consent is never silently
 * granted here.
 */
export function VoicePane() {
  const intl = useIntl();
  const sttPick = useStore($voiceSttEngine);
  const ttsPick = useStore($voiceTtsEngine);
  const consent = useStore($voiceModelsConsent);
  const download = useStore($voiceDownload);
  const micDeviceId = useSsrStore($micDeviceId, "");
  const profile = useSsrStore($providerProfile, null);
  const hasTtsEndpoint = profile?.tts !== undefined;
  const supported = React.useMemo(() => wasmVoiceSupported(), []);

  const [installed, setInstalled] = React.useState<{ stt: boolean; tts: boolean } | null>(null);
  const [resolved, setResolved] = React.useState<{ stt: string; tts: string } | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    void voiceModelBytesInstalled().then((flags) => {
      if (!cancelled) setInstalled(flags);
    });
    void resolveInstalledVoiceEngines().then((r) => {
      if (!cancelled) setResolved(r);
    });
    return () => {
      cancelled = true;
    };
  }, [download.status, sttPick, ttsPick, consent]);

  const [sttTest, setSttTest] = React.useState<VoiceTestState>({ status: "idle" });
  const [ttsTest, setTtsTest] = React.useState<VoiceTestState>({ status: "idle" });
  const [sttOutput, setSttOutput] = React.useState("");
  const liveStt = React.useRef<{ stop: () => void } | null>(null);
  React.useEffect(() => () => liveStt.current?.stop(), []);

  const startDownload = () => {
    void downloadVoiceModels()
      .then(() => voiceModelBytesInstalled().then(setInstalled))
      .catch(() => toast.error(intl.formatMessage({ id: "settings.voicePane.downloadFailed" })));
  };

  /** On-device pick: download when consented, re-arm the prompt otherwise. */
  const onDevice = (ready: boolean | undefined) => {
    if (!supported) return;
    if (consent === "granted") {
      if (!ready) startDownload();
    } else {
      requestVoiceConsent();
    }
  };

  const pickStt = (value: string) => {
    const pick = value as SttEnginePick;
    $voiceSttEngine.set(pick);
    if (pick === "on-device") onDevice(installed?.stt);
  };
  const pickTts = (value: string) => {
    const pick = value as TtsEnginePick;
    $voiceTtsEngine.set(pick);
    if (pick === "on-device") onDevice(installed?.tts);
  };

  const effectiveTtsPick: TtsEnginePick =
    ttsPick === "" ? (hasTtsEndpoint ? "endpoint" : "on-device") : ttsPick;

  /** Test the engines the session will actually use. */
  async function runVoiceTest() {
    const engines = await resolveInstalledVoiceEngines();
    setTtsTest({ status: "running" });
    setSttTest({ status: "running" });
    setSttOutput("");
    // tts first (quick), then stt read-aloud for the mic check
    try {
      if (engines.tts === "endpoint" && profile?.tts) {
        const pcm = await synthesizeSpeech(profile.tts, "hello");
        if (pcm.length === 0) throw new DiError("tts.empty", undefined, "empty audio");
      } else if (engines.tts === "builtin") {
        await testBrowserTts();
      }
      // wasm tts: presence of the verified model files is the test
      setTtsTest({ status: "ok" });
    } catch (err) {
      setTtsTest({
        status: "err",
        message: errorDetail(intl, err),
      });
    }
    if (engines.stt === "builtin") {
      if (!hasBrowserStt()) {
        setSttTest({
          status: "err",
          message: intl.formatMessage({ id: "settings.test.unsupported" }),
        });
        return;
      }
      liveStt.current?.stop();
      liveStt.current = startLiveStt({
        onText: (text) => setSttOutput(text),
        onError: (code) => {
          liveStt.current = null;
          setSttTest({ status: "err", message: codeMessage(intl, code) });
        },
        timeoutMs: 15_000,
      });
      setTimeout(() => {
        if (liveStt.current) {
          liveStt.current.stop();
          liveStt.current = null;
          setSttOutput((output) => {
            setSttTest(
              output.trim()
                ? { status: "ok" }
                : {
                    status: "err",
                    message: intl.formatMessage({ id: "settings.stt.noSpeech" }),
                  },
            );
            return output;
          });
        }
      }, 15_500);
    } else {
      setSttTest(
        installed?.stt
          ? { status: "ok" }
          : {
              status: "err",
              message: intl.formatMessage({ id: "settings.voicePane.notInstalled" }),
            },
      );
    }
  }

  const testing = sttTest.status === "running" || ttsTest.status === "running";
  const modelsReady = installed?.stt && installed?.tts;
  const downloading = download.status === "downloading";

  const modelsStatus = downloading ? (
    <FormattedMessage
      id="settings.voicePane.downloading"
      values={{
        percent: Math.round(download.progress * 100),
        done: fmtMb(download.bytesDone),
        total: fmtMb(download.bytesTotal),
      }}
    />
  ) : modelsReady ? (
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
      values={{ message: codeMessage(intl, download.error) }}
    />
  ) : (
    <FormattedMessage id="settings.voicePane.notInstalled" />
  );

  return (
    <div className="space-y-1">
      {!supported && (
        <p role="note" className="pb-3 text-xs text-persimmon-deep">
          <FormattedMessage id="settings.voicePane.unsupported" />
        </p>
      )}
      {consent === "declined" && supported && (
        <p role="note" className="pb-3 text-xs text-muted-foreground">
          <FormattedMessage id="settings.voice.consentDeclined" />
        </p>
      )}

      <SettingsRow
        title={intl.formatMessage({ id: "settings.voice.mic" })}
        description={intl.formatMessage({ id: "settings.voice.micDesc" })}
      >
        <MicSelector
          value={micDeviceId}
          onValueChange={(id) => $micDeviceId.set(id)}
          className="max-w-56"
        />
      </SettingsRow>

      <SettingsRow
        title={intl.formatMessage({ id: "settings.voice.stt" })}
        description={intl.formatMessage({ id: "settings.voice.sttDesc" })}
      >
        <Select value={sttPick} onValueChange={pickStt}>
          <SelectTrigger
            size="sm"
            className="w-44"
            aria-label={intl.formatMessage({ id: "settings.voice.stt" })}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="on-device" disabled={!supported}>
              {intl.formatMessage({ id: "settings.voice.onDevice" })}
            </SelectItem>
            <SelectItem value="builtin">
              {intl.formatMessage({ id: "settings.voice.builtin" })}
            </SelectItem>
          </SelectContent>
        </Select>
      </SettingsRow>

      <SettingsRow
        title={intl.formatMessage({ id: "settings.voice.tts" })}
        description={intl.formatMessage({ id: "settings.voice.ttsDesc" })}
      >
        <Select value={effectiveTtsPick} onValueChange={pickTts}>
          <SelectTrigger
            size="sm"
            className="w-44"
            aria-label={intl.formatMessage({ id: "settings.voice.tts" })}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="on-device" disabled={!supported}>
              {intl.formatMessage({ id: "settings.voice.onDevice" })}
            </SelectItem>
            <SelectItem value="builtin">
              {intl.formatMessage({ id: "settings.voice.builtin" })}
            </SelectItem>
            {hasTtsEndpoint && (
              <SelectItem value="endpoint">
                {intl.formatMessage({ id: "settings.voice.endpoint" })}
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </SettingsRow>

      <SettingsRow
        title={intl.formatMessage({ id: "settings.voice.models" })}
        description={intl.formatMessage({ id: "settings.voice.modelsDesc" })}
      >
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {modelsStatus}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1"
            onClick={() => openSettings("downloads")}
          >
            <FormattedMessage id="settings.voice.manage" />
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </Button>
        </span>
      </SettingsRow>

      <SettingsRow
        title={intl.formatMessage({ id: "settings.voice.test" })}
        description={intl.formatMessage({ id: "settings.voice.testDesc" })}
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void runVoiceTest()}
          disabled={testing}
          aria-busy={testing}
        >
          {testing ? (
            <>
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              <FormattedMessage id="settings.testing" />
            </>
          ) : (
            <FormattedMessage id="settings.voice.testCta" />
          )}
        </Button>
      </SettingsRow>

      {(resolved?.stt === "builtin" || sttTest.status !== "idle") && (
        <div className="space-y-2 pb-2 pl-1">
          {sttTest.status === "running" || sttOutput ? (
            <Textarea
              readOnly
              value={sttOutput}
              placeholder={intl.formatMessage({ id: "settings.stt.readPlaceholder" })}
              rows={2}
              className="resize-none bg-white text-sm"
              aria-label={intl.formatMessage({ id: "settings.stt.readTitle" })}
            />
          ) : null}
          <TestResult state={sttTest} label={intl.formatMessage({ id: "settings.voice.stt" })} />
          <TestResult state={ttsTest} label={intl.formatMessage({ id: "settings.voice.tts" })} />
        </div>
      )}
    </div>
  );
}

function TestResult(props: { state: VoiceTestState; label: string }) {
  if (props.state.status !== "ok" && props.state.status !== "err") return null;
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
      {props.label}:{" "}
      {props.state.status === "ok" ? (
        <FormattedMessage id="settings.testOk" />
      ) : (
        <FormattedMessage
          id="settings.testFailed"
          values={{ message: props.state.message ?? "" }}
        />
      )}
    </span>
  );
}
