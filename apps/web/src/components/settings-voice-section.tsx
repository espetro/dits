import * as React from "react";
import { useStore } from "@nanostores/react";
import { FormattedMessage, useIntl } from "react-intl";
import { Loader2 } from "lucide-react";

import { SettingsRow } from "./settings-row";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./vendor/select";
import { Button } from "./vendor/button";
import { EndpointFields } from "./endpoint-fields";
import { ModelPackFiles } from "./settings-voice-files";
import { AudioClipPlayer } from "./audio-clip-player";
import { useModelOptions, useSettingsDrafts } from "./settings-drafts";
import { $providerProfile, $serverDriven, $serverReachable } from "../lib/runtime";
import { useSsrStore } from "../lib/ssr";
import { $voiceModelsConsent, $voiceTtsEngine, requestVoiceConsent } from "../stores/voice";
import type { TtsLayerPick } from "../stores/voice";
import { resolveInstalledVoiceEngines } from "../lib/voice/engines";
import { DiError, errorDetail } from "../lib/errors";
import {
  testBrowserTts,
  testServerTts,
  synthesizeSpeech as synthesizeEndpoint,
  WasmTts,
} from "../lib/tts";
import { encodeWav, encodeWavPcm16 } from "../lib/voice/wav";
import { toast } from "sonner";
import { markSeamOp } from "../lib/seam-health";

interface TestState {
  status: "idle" | "synth" | "ready";
  /** measured synthesis time of the last test, when the layer reports it */
  ms?: number;
}

/**
 * Voice: the tts layer select mirroring Hearing (auto/in-browser/wasm/
 * cloud + server when the di app hosts) with its conditional config, then
 * the test row that really synthesizes a phrase into a minimal player.
 */
export function VoiceSection() {
  const intl = useIntl();
  const ttsPick = useStore($voiceTtsEngine);
  const consent = useStore($voiceModelsConsent);
  const profile = useSsrStore($providerProfile, null);
  const serverDriven = useSsrStore($serverDriven, true);
  const reachable = useSsrStore($serverReachable, null);
  const { drafts, update } = useSettingsDrafts();
  const modelOptions = useModelOptions(drafts.tts);

  const serverTest = serverDriven && (ttsPick === "" || ttsPick === "server");

  const [test, setTest] = React.useState<TestState>({ status: "idle" });
  const [clip, setClip] = React.useState<Blob | null>(null);
  const [builtin, setBuiltin] = React.useState(false);
  const engine = React.useRef<WasmTts | null>(null);
  React.useEffect(
    () => () => {
      engine.current?.dispose();
      globalThis.speechSynthesis?.cancel();
    },
    [],
  );

  const pick = (value: string) => {
    // "auto" is the select's display value; the stored pick is "" —
    // pickWantsServer("auto") is false, so storing it raw would flip
    // server-driven resolution off until the next decode on load.
    const v = value === "auto" ? "" : (value as TtsLayerPick);
    $voiceTtsEngine.set(v);
    // a different layer means a different engine — drop stale clip/playback
    setTest({ status: "idle" });
    setClip(null);
    setBuiltin(false);
    globalThis.speechSynthesis?.cancel();
    if (v === "wasm" && consent !== "granted") requestVoiceConsent();
  };

  function reportTestError(err: unknown) {
    const msg = errorDetail(intl, err);
    markSeamOp("tts", false, msg);
    toast.error(msg);
  }

  /** really synthesize the test phrase through the resolved layer */
  async function runTest() {
    const phrase = intl.formatMessage({ id: "settings.voice.testPhrase" });
    setTest({ status: "synth" });
    setClip(null);
    setBuiltin(false);
    try {
      let ms: number | undefined;
      const t0 = performance.now();
      const engines = await resolveInstalledVoiceEngines();
      if (serverTest) {
        const out = await testServerTts(phrase);
        setClip(out.clip);
        ms = out.ms;
      } else if (engines.tts === "wasm") {
        const e = (engine.current ??= new WasmTts());
        const frames: Float32Array[] = [];
        for await (const chunk of e.speak(phrase)) frames.push(chunk);
        if (!frames.length) throw new Error("empty audio");
        setClip(new Blob([encodeWav(frames, 24_000).buffer as ArrayBuffer], { type: "audio/wav" }));
        ms = Math.round(performance.now() - t0);
      } else if (engines.tts === "endpoint" && profile?.tts) {
        const pcm = await synthesizeEndpoint(profile.tts, phrase);
        if (!pcm.length) throw new Error("empty audio");
        setClip(
          new Blob([encodeWavPcm16(Int16Array.from(pcm)).buffer as ArrayBuffer], {
            type: "audio/wav",
          }),
        );
        ms = Math.round(performance.now() - t0);
      } else {
        if (!globalThis.speechSynthesis?.getVoices().length) throw new DiError("tts.builtin");
        setBuiltin(true);
      }
      setTest({ status: "ready", ms });
      markSeamOp("tts", true);
    } catch (err) {
      setTest({ status: "idle" });
      reportTestError(err);
    }
  }

  return (
    <div className="space-y-1">
      <SettingsRow
        title={intl.formatMessage({ id: "settings.layer.tts" })}
        description={intl.formatMessage({ id: "settings.layer.ttsDesc" })}
      >
        <Select value={ttsPick || "auto"} onValueChange={pick}>
          <SelectTrigger
            size="sm"
            className="w-44"
            aria-label={intl.formatMessage({ id: "settings.layer.tts" })}
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
            {(reachable === true || ttsPick === "server") && (
              <SelectItem value="server">
                {intl.formatMessage({ id: "settings.layer.server" })}
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </SettingsRow>

      <ModelPackFiles
        kind="tts"
        device={ttsPick === "wasm"}
        server={ttsPick === "server" || (serverDriven && ttsPick === "")}
      />
      {ttsPick === "cloud" && (
        <div className="pb-3 pl-1">
          <EndpointFields
            tab="tts"
            draft={drafts.tts}
            savedApiKey={profile?.tts?.apiKey ?? null}
            modelOptions={modelOptions}
            onChange={(patch) => update("tts", { enabled: true, ...patch })}
          />
        </div>
      )}
      {ttsPick === "server" && reachable === false && (
        <p role="note" className="pb-2 pl-1 text-xs text-persimmon-deep">
          <FormattedMessage id="settings.layer.serverUnreachable" />
        </p>
      )}
      {consent === "declined" && ttsPick === "wasm" && (
        <p role="note" className="pb-2 pl-1 text-xs text-muted-foreground">
          <FormattedMessage id="settings.voice.consentDeclined" />
        </p>
      )}

      <SettingsRow
        title={intl.formatMessage({ id: "settings.test" })}
        description={intl.formatMessage({ id: "settings.voice.sampleDesc" })}
      >
        <span className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void runTest()}
            disabled={test.status === "synth"}
            aria-busy={test.status === "synth"}
          >
            {test.status === "synth" ? (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                <FormattedMessage id="settings.testing" />
              </>
            ) : (
              <FormattedMessage id="settings.voice.sampleCta" />
            )}
          </Button>
          {test.status === "ready" && (
            <AudioClipPlayer
              src={clip ?? undefined}
              onBuiltinStart={
                builtin
                  ? () =>
                      void testBrowserTts(
                        intl.formatMessage({ id: "settings.voice.testPhrase" }),
                      ).catch(reportTestError)
                  : undefined
              }
              onBuiltinStop={() => globalThis.speechSynthesis?.cancel()}
              onError={reportTestError}
              estimatedMs={intl.formatMessage({ id: "settings.voice.testPhrase" }).length * 70}
            />
          )}
          {test.status === "ready" && test.ms !== undefined && (
            <span className="text-xs tabular-nums text-muted-foreground">
              <FormattedMessage id="settings.voice.sampleMs" values={{ ms: test.ms }} />
            </span>
          )}
        </span>
      </SettingsRow>
    </div>
  );
}
