import type { Config } from "@di/shared";
import { BuiltinSherpaStt } from "../builtin/engines.ts";
import type { EventSink } from "../events.ts";
import { requireRemoteStt, sttProviderOf } from "../providers.ts";
import type { SttPort, StreamingSttPort } from "./port.ts";
import { StreamingWhisperStt } from "./streaming-stt.ts";
import { WhisperStt } from "./whisper-stt.ts";

export interface SttFactoryOptions {
  /** When set (with sessionId), remote adapters emit stt.* pipeline events. */
  events?: EventSink;
  sessionId?: string;
  /** Test seams: replace the adapter that would otherwise be built. */
  stt?: SttPort;
  streamingStt?: StreamingSttPort;
}

export interface SttAdapters {
  stt: SttPort;
  /** Present when the provider streams (builtin, or remote with mode "streaming"). */
  streamingStt: StreamingSttPort | undefined;
}

/** Single place the configured stt adapters are built (voice loop). */
export function createSttFromConfig(
  config: Pick<Config, "stt" | "files">,
  opts: SttFactoryOptions = {},
): SttAdapters {
  if (sttProviderOf(config.stt) === "builtin") {
    // bundled wasm sherpa: streaming-native, covers both ports; an
    // injected stub is expected to satisfy whichever ports get exercised
    const builtin = (opts.streamingStt ??
      opts.stt ??
      new BuiltinSherpaStt({ dataDir: config.files.data_dir })) as SttPort & StreamingSttPort;
    return { stt: builtin, streamingStt: builtin };
  }
  const remote = requireRemoteStt(config.stt);
  const adapterOpts = {
    baseUrl: remote.baseUrl,
    apiKey: remote.apiKey,
    model: remote.model,
    events: opts.events,
    sessionId: opts.sessionId,
  };
  return {
    stt: opts.stt ?? new WhisperStt(adapterOpts),
    streamingStt:
      remote.mode === "streaming"
        ? (opts.streamingStt ?? new StreamingWhisperStt(adapterOpts))
        : undefined,
  };
}
