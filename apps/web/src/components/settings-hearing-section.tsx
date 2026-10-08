import * as React from "react";
import { useStore } from "@nanostores/react";
import { FormattedMessage, useIntl } from "react-intl";
import { Check, Loader2, X } from "lucide-react";

import { SettingsRow } from "./settings-row";
import { MicSelector } from "./mic-selector";
import { Textarea } from "./vendor/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./vendor/select";
import { Button } from "./vendor/button";
import { LiveWaveform } from "./vendor/live-waveform";
import { EndpointFields } from "./endpoint-fields";
import { VoicePackFiles } from "./settings-voice-files";
import { useModelOptions, useSettingsDrafts } from "./settings-drafts";
import { $providerProfile, $serverDriven, $serverReachable } from "../lib/runtime";
import { useSsrStore } from "../lib/ssr";
import { $micDeviceId } from "../stores/devices";
import { $voiceModelsConsent, $voiceSttEngine, requestVoiceConsent } from "../stores/voice";
import type { SttLayerPick } from "../stores/voice";
import { resolveInstalledVoiceEngines } from "../lib/voice/engines";
import { WasmStt } from "../lib/voice/wasm-engines";
import { EndpointStt } from "../lib/voice/endpoint-stt";
import { hasBrowserStt, startEngineSttTest, startLiveStt } from "../lib/settings-tests";
import { codeMessage, errorDetail } from "../lib/errors";
import { markSeamOp } from "../lib/seam-health";

interface TestState {
  status: "idle" | "running" | "ok" | "err";
  message?: string;
}

/** the di server's .cpp pipeline owns the seam — nothing to test here */
function ServerOwnedNote() {
  return (
    <p className="pb-2 pl-1 text-xs text-muted-foreground">
      <FormattedMessage id="settings.layer.serverOwned" />
    </p>
  );
}

/**
 * Hearing: mic picker, the stt layer select (auto/in-browser/wasm/cloud +
 * server when the di app hosts), the layer's conditional config, and the
 * capture test (live waveform + recognized text).
 */
export function HearingSection() {
  const intl = useIntl();
  const sttPick = useStore($voiceSttEngine);
  const consent = useStore($voiceModelsConsent);
  const micDeviceId = useSsrStore($micDeviceId, "");
  const profile = useSsrStore($providerProfile, null);
  const serverDriven = useSsrStore($serverDriven, true);
  const reachable = useSsrStore($serverReachable, null);
  const { drafts, update } = useSettingsDrafts();
  const modelOptions = useModelOptions(drafts.stt);

  const serverTest = serverDriven && (sttPick === "" || sttPick === "server");

  const [test, setTest] = React.useState<TestState>({ status: "idle" });
  const [output, setOutput] = React.useState("");
  const liveTest = React.useRef<{ stop: () => void | Promise<void> } | null>(null);
  React.useEffect(
    () => () => {
      void liveTest.current?.stop();
    },
    [],
  );

  const markResult = (t: TestState) => {
    setTest(t);
    if (t.status === "ok") markSeamOp("stt", true);
    else if (t.status === "err") markSeamOp("stt", false, t.message);
  };

  const pick = (value: string) => {
    const v = value as SttLayerPick;
    $voiceSttEngine.set(v);
    // a different layer means a different engine — drop stale results and
    // release the mic if a test was still listening
    void liveTest.current?.stop();
    liveTest.current = null;
    setTest({ status: "idle" });
    setOutput("");
    if (v === "wasm" && consent !== "granted") requestVoiceConsent();
  };

  async function runTest() {
    setTest({ status: "running" });
    setOutput("");
    void liveTest.current?.stop();
    const engines = await resolveInstalledVoiceEngines();
    try {
      if (engines.stt === "builtin") {
        if (!hasBrowserStt())
          throw new Error(intl.formatMessage({ id: "settings.test.unsupported" }));
        liveTest.current = startLiveStt({
          onText: (t) => setOutput(t),
          onError: (code) => {
            liveTest.current = null;
            markResult({ status: "err", message: codeMessage(intl, code) });
          },
          timeoutMs: 12_000,
        });
        setTimeout(async () => {
          if (liveTest.current) {
            await liveTest.current.stop();
            liveTest.current = null;
            setOutput((o) => {
              setTest(
                o.trim()
                  ? { status: "ok" }
                  : { status: "err", message: intl.formatMessage({ id: "settings.stt.noSpeech" }) },
              );
              return o;
            });
          }
        }, 12_500);
        return;
      }
      const handle = await startEngineSttTest({
        create: () =>
          engines.stt === "endpoint" && profile?.stt ? new EndpointStt(profile.stt) : new WasmStt(),
        deviceId: micDeviceId || undefined,
        onText: (t) => setOutput(t),
        onError: (m) => markResult({ status: "err", message: m }),
        timeoutMs: 12_000,
      });
      liveTest.current = handle;
      setTimeout(async () => {
        if (liveTest.current === handle) {
          await handle.stop();
          liveTest.current = null;
          setOutput((o) => {
            markResult(
              o.trim()
                ? { status: "ok" }
                : { status: "err", message: intl.formatMessage({ id: "settings.stt.noSpeech" }) },
            );
            return o;
          });
        }
      }, 12_500);
    } catch (err) {
      markResult({ status: "err", message: errorDetail(intl, err) });
    }
  }

  return (
    <div className="space-y-1">
      <SettingsRow
        title={intl.formatMessage({ id: "settings.stt.micLabel" })}
        description={intl.formatMessage({ id: "settings.stt.micHelp" })}
      >
        <MicSelector
          value={micDeviceId}
          onValueChange={(id) => $micDeviceId.set(id)}
          className="max-w-56"
        />
      </SettingsRow>

      <SettingsRow
        title={intl.formatMessage({ id: "settings.layer.stt" })}
        description={intl.formatMessage({ id: "settings.layer.sttDesc" })}
      >
        <Select value={sttPick || "auto"} onValueChange={pick}>
          <SelectTrigger
            size="sm"
            className="w-44"
            aria-label={intl.formatMessage({ id: "settings.layer.stt" })}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">
              {intl.formatMessage({ id: "settings.layer.auto" })}
            </SelectItem>
            <SelectItem value="in-browser">
              {intl.formatMessage({ id: "settings.layer.inBrowser" })}
            </SelectItem>
            <SelectItem value="wasm">
              {intl.formatMessage({ id: "settings.layer.wasm" })}
            </SelectItem>
            <SelectItem value="cloud">
              {intl.formatMessage({ id: "settings.layer.cloud" })}
            </SelectItem>
            {(reachable === true || sttPick === "server") && (
              <SelectItem value="server">
                {intl.formatMessage({ id: "settings.layer.server" })}
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </SettingsRow>

      {sttPick === "wasm" && <VoicePackFiles />}
      {sttPick === "cloud" && (
        <div className="pb-3 pl-1">
          <EndpointFields
            tab="stt"
            draft={drafts.stt}
            savedApiKey={profile?.stt?.apiKey ?? null}
            modelOptions={modelOptions}
            onChange={(patch) => update("stt", { enabled: true, ...patch })}
          />
        </div>
      )}
      {sttPick === "server" && reachable === false && (
        <p role="note" className="pb-2 pl-1 text-xs text-persimmon-deep">
          <FormattedMessage id="settings.layer.serverUnreachable" />
        </p>
      )}
      {consent === "declined" && sttPick === "wasm" && (
        <p role="note" className="pb-2 pl-1 text-xs text-muted-foreground">
          <FormattedMessage id="settings.voice.consentDeclined" />
        </p>
      )}

      {serverTest ? (
        <ServerOwnedNote />
      ) : (
        <>
          <SettingsRow
            title={intl.formatMessage({ id: "settings.test" })}
            description={intl.formatMessage({ id: "settings.stt.readHelp" })}
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void runTest()}
              disabled={test.status === "running"}
              aria-busy={test.status === "running"}
            >
              {test.status === "running" ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  <FormattedMessage id="settings.stt.listening" />
                </>
              ) : (
                <FormattedMessage id="settings.voice.testCta" />
              )}
            </Button>
          </SettingsRow>
          {(test.status === "running" || output) && (
            <div className="space-y-2 pb-2 pl-1">
              <LiveWaveform
                active={test.status === "running"}
                deviceId={micDeviceId || undefined}
                mode="static"
                height={20}
                barWidth={3}
                barGap={1}
                className="w-40 overflow-hidden rounded-md bg-accent p-1.5"
              />
              <Textarea
                readOnly
                value={output}
                placeholder={intl.formatMessage({ id: "settings.stt.readPlaceholder" })}
                rows={2}
                className="resize-none bg-white text-sm"
                aria-label={intl.formatMessage({ id: "settings.stt.readTitle" })}
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
                <FormattedMessage
                  id="settings.testFailed"
                  values={{ message: test.message ?? "" }}
                />
              )}
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}
