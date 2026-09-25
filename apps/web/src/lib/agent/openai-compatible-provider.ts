import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FunctionTool,
  LanguageModelV3Message,
  LanguageModelV3Prompt,
  LanguageModelV3ProviderTool,
  LanguageModelV3StreamPart,
  LanguageModelV3ToolCall,
  LanguageModelV3Usage,
} from "@ai-sdk/provider";
import type { ProviderEndpoint } from "@di/shared";

/**
 * Minimal OpenAI-compatible LanguageModelV3 provider for client-only mode.
 * A thin fetch wrapper around ${baseUrl}/chat/completions: streaming SSE
 * (`stream: true`) with tool-call support. No vendor SDK, no node deps.
 */

interface OpenAiFunctionCall {
  name: string;
  arguments: string;
}

interface OpenAiToolCall {
  id: string;
  type: "function";
  function: OpenAiFunctionCall;
}

interface OpenAiStreamToolCallDelta {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAiStreamDelta {
  content?: string | null;
  tool_calls?: OpenAiStreamToolCallDelta[];
}

interface OpenAiStreamChoice {
  delta?: OpenAiStreamDelta;
}

interface OpenAiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

interface OpenAiStreamChunk {
  choices?: OpenAiStreamChoice[];
  usage?: OpenAiUsage;
}

interface OpenAiGenerateMessage {
  content?: string | null;
  tool_calls?: OpenAiToolCall[];
}

interface OpenAiGenerateChoice {
  message?: OpenAiGenerateMessage;
}

interface OpenAiGenerateResponse {
  choices?: OpenAiGenerateChoice[];
  usage?: OpenAiUsage;
}

/** Normalize a base URL like the server's providerUrl() does: strip trailing /v1. */
function chatUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  const bare = trimmed.replace(/\/v1$/, "");
  return `${bare}/v1/chat/completions`;
}

/** Map a v3 prompt to OpenAI wire messages. */
function toOpenAiMessages(prompt: LanguageModelV3Prompt): Record<string, unknown>[] {
  return prompt.map((msg) => {
    if (msg.role === "system") return { role: "system", content: msg.content };
    if (msg.role === "user") {
      return {
        role: "user",
        content: msg.content.map((p) => ("text" in p ? p.text : "")).join(""),
      };
    }
    if (msg.role === "assistant") {
      const text: string[] = [];
      const toolCalls: OpenAiToolCall[] = [];
      for (const part of msg.content) {
        if (part.type === "text") text.push(part.text);
        else if (part.type === "tool-call")
          toolCalls.push({
            id: part.toolCallId,
            type: "function",
            function: {
              name: part.toolName,
              arguments: JSON.stringify(part.input),
            },
          });
      }
      return {
        role: "assistant",
        content: text.join("") || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      };
    }
    // tool role
    const outputs = msg.content
      .filter((p): p is Extract<typeof p, { type: "tool-result" }> => p.type === "tool-result")
      .map((p) => ({
        tool_call_id: p.toolCallId,
        role: "tool",
        content: toolOutputToString(p.output),
      }));
    return outputs[0] ?? { role: "tool", content: "" };
  });
}

function toolOutputToString(output: unknown): string {
  if (typeof output === "string") return output;
  return JSON.stringify(output);
}

interface OpenAiFunctionToolDef {
  type: "function";
  function: { name: string; description?: string; parameters: unknown };
}

function isFunctionTool(
  t: LanguageModelV3FunctionTool | LanguageModelV3ProviderTool,
): t is LanguageModelV3FunctionTool {
  return t.type === "function";
}

function toOpenAiTools(
  tools: (LanguageModelV3FunctionTool | LanguageModelV3ProviderTool)[] | undefined,
): OpenAiFunctionToolDef[] | undefined {
  const functionTools = tools?.filter(isFunctionTool);
  if (!functionTools?.length) return undefined;
  return functionTools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

interface ToolCallAccumulatorEntry {
  id: string;
  name: string;
  args: string;
}

/** Accumulate SSE deltas into tool calls with buffered argument strings. */
function makeToolCallAccumulator() {
  const calls = new Map<string, ToolCallAccumulatorEntry>();
  return {
    keys: () => calls.keys(),
    start(id: string, name: string) {
      calls.set(id, { id, name, args: "" });
    },
    delta(id: string, delta: string) {
      const c = calls.get(id);
      if (c) c.args += delta;
    },
    finish(): { calls: LanguageModelV3ToolCall[]; hasTools: boolean } {
      return {
        calls: [...calls.values()].map((c) => ({
          type: "tool-call" as const,
          toolCallId: c.id,
          toolName: c.name,
          input: c.args || "{}",
        })),
        hasTools: calls.size > 0,
      };
    },
  };
}

export interface OpenAiCompatibleOptions extends Partial<
  Pick<LanguageModelV3CallOptions, "abortSignal">
> {
  fetchImpl?: typeof fetch;
}

export function createOpenAiCompatibleModel(
  endpoint: ProviderEndpoint,
  opts: OpenAiCompatibleOptions = {},
): LanguageModelV3 {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    specificationVersion: "v3",
    provider: "openai-compatible",
    modelId: endpoint.model,
    supportedUrls: {},

    async doStream(options) {
      const res = await doFetch(chatUrl(endpoint.baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${endpoint.apiKey}`,
        },
        body: JSON.stringify({
          model: endpoint.model,
          messages: toOpenAiMessages(options.prompt),
          stream: true,
          ...(toOpenAiTools(options.tools) ? { tools: toOpenAiTools(options.tools) } : {}),
          ...(options.toolChoice ? { tool_choice: options.toolChoice.type } : {}),
        }),
        signal: options.abortSignal ?? opts.abortSignal,
      });
      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => "");
        throw new Error(`llm chat failed: ${res.status} ${body}`);
      }

      const tools = makeToolCallAccumulator();
      const textId = "t0";
      const decoder = new TextDecoder();
      const reader = res.body.getReader();
      let buffer = "";
      const usage: LanguageModelV3Usage = {
        inputTokens: {
          total: undefined,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: undefined,
          text: undefined,
          reasoning: undefined,
        },
      };
      let sawTextStart = false;

      const stream = new ReadableStream<LanguageModelV3StreamPart>({
        async start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              let nl: number;
              while ((nl = buffer.indexOf("\n")) >= 0) {
                const line = buffer.slice(0, nl).trim();
                buffer = buffer.slice(nl + 1);
                if (!line.startsWith("data:")) continue;
                const payload = line.slice(5).trim();
                if (payload === "[DONE]") continue;
                let chunk: OpenAiStreamChunk;
                try {
                  chunk = JSON.parse(payload);
                } catch {
                  continue;
                }
                if (chunk.usage) {
                  usage.inputTokens.total = chunk.usage.prompt_tokens;
                  usage.outputTokens.total = chunk.usage.completion_tokens;
                }
                for (const choice of chunk.choices ?? []) {
                  const delta = choice.delta ?? {};
                  if (typeof delta.content === "string" && delta.content) {
                    if (!sawTextStart) {
                      sawTextStart = true;
                      controller.enqueue({ type: "text-start", id: textId });
                    }
                    controller.enqueue({
                      type: "text-delta",
                      id: textId,
                      delta: delta.content,
                    });
                  }
                  for (const tc of delta.tool_calls ?? []) {
                    if (tc.id) tools.start(tc.id, tc.function?.name ?? "");
                    else if (tc.function?.arguments) {
                      const last = [...tools.keys()].at(-1);
                      if (last !== undefined) tools.delta(last, tc.function.arguments);
                    }
                  }
                }
              }
            }
          } finally {
            reader.releaseLock?.();
          }
          if (sawTextStart) controller.enqueue({ type: "text-end", id: textId });
          const { calls: finished, hasTools } = tools.finish();
          for (const call of finished) {
            controller.enqueue({
              type: "tool-input-start",
              id: call.toolCallId,
              toolName: call.toolName,
            });
            controller.enqueue({
              type: "tool-input-delta",
              id: call.toolCallId,
              delta: call.input,
            });
            controller.enqueue({ type: "tool-input-end", id: call.toolCallId });
            controller.enqueue({
              type: "tool-call",
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              input: call.input,
            });
          }
          controller.enqueue({
            type: "finish",
            usage,
            finishReason: {
              unified: hasTools ? "tool-calls" : "stop",
              raw: hasTools ? "tool_calls" : "stop",
            },
          });
          controller.close();
        },
        cancel() {
          void reader.cancel();
        },
      });

      return { stream };
    },

    async doGenerate(options) {
      const res = await doFetch(chatUrl(endpoint.baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${endpoint.apiKey}`,
        },
        body: JSON.stringify({
          model: endpoint.model,
          messages: toOpenAiMessages(options.prompt),
          ...(toOpenAiTools(options.tools) ? { tools: toOpenAiTools(options.tools) } : {}),
        }),
        signal: options.abortSignal ?? opts.abortSignal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`llm chat failed: ${res.status} ${body}`);
      }
      const data = (await res.json()) as OpenAiGenerateResponse;
      const message = data.choices?.[0]?.message;
      const content: LanguageModelV3Content[] = [];
      if (message?.content) content.push({ type: "text", text: message.content });
      for (const call of message?.tool_calls ?? []) {
        content.push({
          type: "tool-call",
          toolCallId: call.id,
          toolName: call.function.name,
          input: call.function.arguments,
        });
      }
      const finish = message?.tool_calls?.length ? "tool-calls" : "stop";
      return {
        content,
        finishReason: { unified: finish, raw: finish },
        usage: {
          inputTokens: {
            total: data.usage?.prompt_tokens,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: data.usage?.completion_tokens,
            text: undefined,
            reasoning: undefined,
          },
        },
        warnings: [],
        response: { headers: Object.fromEntries(res.headers) },
      };
    },
  } satisfies LanguageModelV3;
}

export type { LanguageModelV3Message };
