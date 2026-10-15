import type { Config } from "@di/shared";
import type { EventSink } from "../events.ts";
import { OpenAiChatClient } from "./openai-chat.ts";
import type { LlmPort } from "./port.ts";

export interface LlmFactoryOptions {
  /** When set (with sessionId), the adapter emits llm.* pipeline events. */
  events?: EventSink;
  sessionId?: string;
}

/** Single place the configured llm adapter is built (voice loop and report generation). */
export function createLlmFromConfig(llm: Config["llm"], opts: LlmFactoryOptions = {}): LlmPort {
  return new OpenAiChatClient({
    baseUrl: llm.base_url,
    apiKey: llm.api_key,
    model: llm.model,
    flavor: llm.flavor,
    reasoningExclude: llm.reasoning_exclude,
    thinkingDisabled: llm.thinking_disabled,
    maxTokens: llm.max_tokens,
    events: opts.events,
    sessionId: opts.sessionId,
  });
}
