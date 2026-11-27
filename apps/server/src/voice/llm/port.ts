/** OpenAI function-tool definition (name/description/parameters JSON schema). */
export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: { id: string; name: string; arguments: string }[];
}

export interface LlmResult {
  content: string;
  toolCalls: { name: string; args: Record<string, unknown> }[];
}

/** Chat completion port the voice loop and report generator depend on. */
export interface LlmPort {
  chat(
    messages: LlmMessage[],
    tools?: readonly ToolDef[],
    opts?: { signal?: AbortSignal },
  ): Promise<LlmResult>;
  /** Streaming variant for pipelined sentence TTS; falls back to chat() if absent. */
  streamChat?(
    messages: LlmMessage[],
    tools?: readonly ToolDef[],
    opts?: {
      signal?: AbortSignal;
      onFirstToken?: () => void;
      onText?: (delta: string) => void;
    },
  ): Promise<LlmResult>;
}
