import type { Config } from "@di/shared";
import { BuiltinKittenTts } from "../builtin/engines.ts";
import type { EventSink } from "../events.ts";
import { requireRemoteTts, ttsProviderOf } from "../providers.ts";
import { PocketTts } from "./pocket-tts.ts";
import type { TtsPort } from "./port.ts";

export interface TtsFactoryOptions {
  /** When set (with sessionId), remote adapters emit tts.* pipeline events. */
  events?: EventSink;
  sessionId?: string;
}

/** Single place the configured tts adapter is built (voice loop and tts test route). */
export function createTtsFromConfig(
  config: Pick<Config, "tts" | "files">,
  opts: TtsFactoryOptions = {},
): TtsPort {
  if (ttsProviderOf(config.tts) === "builtin")
    return new BuiltinKittenTts({ dataDir: config.files.data_dir });
  const remote = requireRemoteTts(config.tts);
  return new PocketTts({
    baseUrl: remote.baseUrl,
    apiKey: remote.apiKey,
    model: remote.model,
    voice: remote.voice,
    events: opts.events,
    sessionId: opts.sessionId,
  });
}
