import type { EventSink } from "./stt/whisper-stt.ts";
import { providerUrl } from "./provider-url.ts";

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

export interface OpenAiChatOptions {
  baseUrl: string;
  apiKey?: string;
  model: string;
  /** Wire protocol; "anthropic" posts to /v1/messages instead of chat/completions. */
  flavor?: "openai" | "anthropic";
  fetchImpl?: typeof fetch;
  /** When set, emit llm.request/llm.result pipeline events. */
  events?: EventSink;
  sessionId?: string;
}

/**
 * Thin OpenAI-compatible chat completions client.
 *
 * Providers `openai` and `mock` speak the protocol natively; `anthropic`
 * rides an OpenAI-compatible gateway (e.g. Bifrost) at the configured
 * base_url, so the same request shape is used for all providers.
 */
export class OpenAiChatClient {
  constructor(private opts: OpenAiChatOptions) {}

  async chat(
    messages: LlmMessage[],
    tools?: readonly ToolDef[],
    opts?: { signal?: AbortSignal },
  ): Promise<LlmResult> {
    if ((this.opts.flavor ?? "openai") === "anthropic")
      return this.anthropicChat(messages, tools, opts);
    const { events, sessionId } = this.opts;
    events
      ?.postEvent(sessionId!, "llm.request", {
        message_count: messages.length,
        tool_count: tools?.length ?? 0,
      })
      .catch((err) => console.warn(`[voice] failed to log llm.request: ${err}`));
    const startedAt = Date.now();

    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.opts.apiKey) {
      headers.authorization = `Bearer ${this.opts.apiKey}`;
    }
    const res = await (this.opts.fetchImpl ?? fetch)(
      `${providerUrl(this.opts.baseUrl)}/v1/chat/completions`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: this.opts.model,
          messages,
          ...(tools && tools.length > 0
            ? { tools: tools.map((t) => ({ type: "function", function: t })) }
            : {}),
        }),
        signal: opts?.signal,
      },
    );
    const latency_ms = Date.now() - startedAt;
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      events
        ?.postEvent(sessionId!, "llm.failed", {
          status: res.status,
          body,
          latency_ms,
        })
        .catch(() => undefined);
      throw new Error(`llm chat failed: ${res.status} ${body}`);
    }
    const json = (await res.json()) as {
      choices?: {
        message?: {
          content?: string;
          tool_calls?: {
            id: string;
            function: { name: string; arguments: string };
          }[];
        };
      }[];
    };
    const message = json.choices?.[0]?.message;
    const toolCalls = (message?.tool_calls ?? []).map((tc) => ({
      name: tc.function.name,
      args: parseToolArgs(tc.function.arguments),
    }));
    const content = message?.content ?? "";
    events
      ?.postEvent(sessionId!, "llm.result", {
        text_length: content.length,
        tool_calls: toolCalls.length,
        latency_ms,
      })
      .catch(() => undefined);
    return { content, toolCalls };
  }
  /**
   * Streaming chat: same LlmResult as chat(), parsed incrementally from SSE
   * (`data: ` lines, `[DONE]` sentinel). Non-SSE responses (some gateways
   * ignore stream:true) fall back to buffered JSON parsing.
   */
  /**
   * Anthropic Messages API (/v1/messages) path. Maps the shared LlmMessage/
   * ToolDef shapes into Anthropic's request and content blocks back into
   * LlmResult.
   */
  private async anthropicChat(
    messages: LlmMessage[],
    tools?: readonly ToolDef[],
    opts?: { signal?: AbortSignal },
  ): Promise<LlmResult> {
    const { events, sessionId } = this.opts;
    events
      ?.postEvent(sessionId!, "llm.request", {
        message_count: messages.length,
        tool_count: tools?.length ?? 0,
        flavor: "anthropic",
      })
      .catch((err) => console.warn(`[voice] failed to log llm.request: ${err}`));
    const startedAt = Date.now();

    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const body = {
      model: this.opts.model,
      max_tokens: 1024,
      ...(system ? { system } : {}),
      messages: messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, content: m.content })),
      ...(tools && tools.length > 0
        ? {
            tools: tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.parameters,
            })),
          }
        : {}),
    };
    const res = await (this.opts.fetchImpl ?? fetch)(
      `${providerUrl(this.opts.baseUrl)}/v1/messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.opts.apiKey ? { "x-api-key": this.opts.apiKey } : {}),
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
        signal: opts?.signal,
      },
    );
    const latency_ms = Date.now() - startedAt;
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      events
        ?.postEvent(sessionId!, "llm.failed", {
          status: res.status,
          body: errBody,
          latency_ms,
        })
        .catch(() => undefined);
      throw new Error(`llm chat failed: ${res.status} ${errBody}`);
    }
    const json = (await res.json()) as {
      content?: {
        type: string;
        text?: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      }[];
    };
    const content = (json.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    const toolCalls = (json.content ?? [])
      .filter((b) => b.type === "tool_use")
      .map((b) => ({ name: b.name ?? "", args: b.input ?? {} }));
    events
      ?.postEvent(sessionId!, "llm.result", {
        text_length: content.length,
        tool_calls: toolCalls.length,
        latency_ms,
      })
      .catch(() => undefined);
    return { content, toolCalls };
  }

  async streamChat(
    messages: LlmMessage[],
    tools?: readonly ToolDef[],
    opts?: {
      signal?: AbortSignal;
      onFirstToken?: () => void;
      onText?: (delta: string) => void;
    },
  ): Promise<LlmResult> {
    // Anthropic SSE differs from OpenAI's; fall back to buffered chat() for now.
    if ((this.opts.flavor ?? "openai") === "anthropic")
      return this.chat(messages, tools, { signal: opts?.signal });
    const { events, sessionId } = this.opts;
    events
      ?.postEvent(sessionId!, "llm.request", {
        message_count: messages.length,
        tool_count: tools?.length ?? 0,
        stream: true,
      })
      .catch((err) => console.warn(`[voice] failed to log llm.request: ${err}`));
    const startedAt = Date.now();

    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.opts.apiKey) {
      headers.authorization = `Bearer ${this.opts.apiKey}`;
    }
    const res = await (this.opts.fetchImpl ?? fetch)(
      `${providerUrl(this.opts.baseUrl)}/v1/chat/completions`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: this.opts.model,
          messages,
          stream: true,
          ...(tools && tools.length > 0
            ? { tools: tools.map((t) => ({ type: "function", function: t })) }
            : {}),
        }),
        signal: opts?.signal,
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      events
        ?.postEvent(sessionId!, "llm.failed", {
          status: res.status,
          body,
          latency_ms: Date.now() - startedAt,
        })
        .catch(() => undefined);
      throw new Error(`llm chat failed: ${res.status} ${body}`);
    }

    let content = "";
    let firstTokenAt: number | undefined;
    /** Tool calls keyed by delta index; arguments arrive as fragments. */
    const toolAcc = new Map<number, { id: string; name: string; args: string }>();
    let sawSse = (res.headers.get("content-type") ?? "").includes("text/event-stream");

    if (sawSse && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      const handleLine = (line: string) => {
        if (!line.startsWith("data:")) return;
        const data = line.slice(5).trim();
        if (data === "" || data === "[DONE]") return;
        let delta: {
          content?: string;
          tool_calls?: {
            index: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }[];
        };
        try {
          delta = JSON.parse(data).choices?.[0]?.delta ?? {};
        } catch {
          return;
        }
        if (typeof delta.content === "string" && delta.content !== "") {
          if (firstTokenAt === undefined) {
            firstTokenAt = Date.now();
            opts?.onFirstToken?.();
          }
          content += delta.content;
          opts?.onText?.(delta.content);
        }
        for (const tc of delta.tool_calls ?? []) {
          const entry = toolAcc.get(tc.index) ?? { id: "", name: "", args: "" };
          if (tc.id) entry.id = tc.id;
          if (tc.function?.name) entry.name += tc.function.name;
          if (tc.function?.arguments) entry.args += tc.function.arguments;
          toolAcc.set(tc.index, entry);
        }
      };
      const pump = async (): Promise<void> => {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            handleLine(buf.slice(0, nl).replace(/\r$/, ""));
            buf = buf.slice(nl + 1);
          }
        }
        if (buf.trim() !== "") handleLine(buf.replace(/\r$/, ""));
      };
      try {
        await pump();
      } catch (err) {
        // A stream error after headers may still carry partial content.
        if (content === "" && toolAcc.size === 0) {
          events
            ?.postEvent(sessionId!, "llm.failed", {
              status: res.status,
              error: String(err),
              latency_ms: Date.now() - startedAt,
            })
            .catch(() => undefined);
          throw err;
        }
      }
    } else {
      // Gateway ignored stream:true: parse as a normal completion.
      sawSse = false;
      const json = (await res.json()) as {
        choices?: {
          message?: {
            content?: string;
            tool_calls?: {
              id: string;
              function: { name: string; arguments: string };
            }[];
          };
        }[];
      };
      const message = json.choices?.[0]?.message;
      content = message?.content ?? "";
      if (content !== "") {
        firstTokenAt = Date.now();
        opts?.onFirstToken?.();
        opts?.onText?.(content);
      }
      for (const [i, tc] of (message?.tool_calls ?? []).entries()) {
        toolAcc.set(i, {
          id: tc.id,
          name: tc.function.name,
          args: tc.function.arguments,
        });
      }
    }

    const toolCalls = [...toolAcc.entries()]
      .sort(([a], [b]) => a - b)
      .filter(([, tc]) => tc.name !== "")
      .map(([, tc]) => ({ name: tc.name, args: parseToolArgs(tc.args) }));
    const ttft_ms = firstTokenAt === undefined ? undefined : firstTokenAt - startedAt;
    events
      ?.postEvent(sessionId!, "llm.result", {
        text_length: content.length,
        tool_calls: toolCalls.length,
        latency_ms: Date.now() - startedAt,
        stream: sawSse,
        ...(ttft_ms === undefined ? {} : { ttft_ms }),
      })
      .catch(() => undefined);
    return { content, toolCalls };
  }
}

function parseToolArgs(raw: string): Record<string, unknown> {
  if (raw === undefined || raw === "") return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { _raw: raw };
  }
}
