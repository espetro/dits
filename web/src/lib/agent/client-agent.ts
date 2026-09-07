import { toJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import { VOICE_TOOLS, assertNever, buildPrompt, describeWhiteboardSnapshot } from "@di/shared";
import type {
  LlmSection,
  SessionContext,
  ToolDef,
  TurnEvents,
  TurnPhase,
  TurnRunner,
  UpdateQuestionArgs,
} from "@di/shared";
import type { LanguageModelV3, LanguageModelV4 } from "@ai-sdk/provider";
import { type BrowserModelHandles, createLlmModel, resolveBrowserLlm } from "./browser-provider";
import { createOpenAiCompatibleModel } from "./openai-compatible-provider";

/** Model spec version accepted by ai v7's model union. */
type AnyLanguageModel = LanguageModelV3 | LanguageModelV4;

/**
 * ClientAgent: the client-only interview loop. Mirrors the server's VoiceLoop
 * LLM hop (system prompt from shared buildPrompt + the three VOICE_TOOLS)
 * using the AI SDK's streamText + our openai-compatible provider. The `ai`
 * package is imported lazily so local-server builds don't pay for it.
 */

export interface AgentToolExecutors {
  update_question(args: UpdateQuestionArgs): Promise<string>;
  read_editor(args: Record<string, never>): Promise<string>;
  read_whiteboard(args: Record<string, never>): Promise<string>;
}

/** Internal chat message history (assistant text only; tool hops inline). */
interface ChatMsg {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Plain JSON-schema tool spec sent to the model (from shared VOICE_TOOLS). */
function toolDef(name: string): ToolDef {
  const def = VOICE_TOOLS.find((t) => t.name === name);
  if (!def) throw new Error(`unknown voice tool: ${name}`);
  return def;
}

/** Longest suffix of `text` that is a proper prefix of `tag` (for split tags). */
function partialTagSuffix(text: string, tag: string): number {
  for (let len = Math.min(tag.length - 1, text.length); len > 0; len--) {
    if (text.endsWith(tag.slice(0, len))) return len;
  }
  return 0;
}

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

/**
 * State machine over text deltas that suppresses `\<think>...\</think>`
 * reasoning traces (qwen3 can emit them even with thinking disabled),
 * including when the tags are split across chunk boundaries.
 */
class ThinkFilter {
  private inside = false;
  private buffer = "";

  push(delta: string): string {
    this.buffer += delta;
    let out = "";
    for (;;) {
      if (this.inside) {
        const end = this.buffer.indexOf(THINK_CLOSE);
        if (end === -1) {
          const keep = partialTagSuffix(this.buffer, THINK_CLOSE);
          this.buffer = this.buffer.slice(this.buffer.length - keep);
          return out;
        }
        this.buffer = this.buffer.slice(end + THINK_CLOSE.length);
        this.inside = false;
      } else {
        const start = this.buffer.indexOf(THINK_OPEN);
        if (start === -1) {
          const keep = partialTagSuffix(this.buffer, THINK_OPEN);
          const cut = this.buffer.length - keep;
          out += this.buffer.slice(0, cut);
          this.buffer = this.buffer.slice(cut);
          return out;
        }
        out += this.buffer.slice(0, start);
        this.buffer = this.buffer.slice(start + THINK_OPEN.length);
        this.inside = true;
      }
    }
  }

  /** At end of stream, buffered text outside a think block is real text. */
  flush(): string {
    const rest = this.inside ? "" : this.buffer;
    this.buffer = "";
    return rest;
  }
}

/** Strip think traces from a complete generated text. */
function stripThink(text: string): string {
  const filter = new ThinkFilter();
  return filter.push(text) + filter.flush();
}

export interface RespondOptions extends TurnEvents {
  signal?: AbortSignal;
}

/** Default error sink: never swallow, always surface to the console. */
function defaultOnError(error: unknown, phase: TurnPhase): void {
  switch (phase) {
    case "llm":
      console.error("[ClientAgent] llm turn failed", error);
      break;
    case "tool":
      console.error("[ClientAgent] tool call failed", error);
      break;
    case "tts":
      console.error("[ClientAgent] tts failed", error);
      break;
    default:
      assertNever(phase);
  }
}

/** Same hop budget as the server's VoiceLoop (server/src/voice/loop.ts). */
const MAX_HOPS = 4;

/** Verbatim tail kept in the request (last N messages). */
const WINDOW_MESSAGES = 16;
/** Compact once more than this many messages have aged past the window. */
const COMPACT_BATCH = 4;

export class ClientAgent implements TurnRunner {
  private history: ChatMsg[] = [];
  private model: AnyLanguageModel;
  private browserHandles: BrowserModelHandles | null = null;
  /** Rolling summary of turns evicted from the verbatim window. */
  private rollingSummary = "";

  private readonly llm: LlmSection;
  private readonly tools: AgentToolExecutors;
  private readonly getContext: () => SessionContext;
  private readonly fetchImpl?: typeof fetch;

  private constructor(
    model: AnyLanguageModel,
    browserHandles: BrowserModelHandles | null,
    llm: LlmSection,
    tools: AgentToolExecutors,
    getContext: () => SessionContext,
    fetchImpl?: typeof fetch,
  ) {
    this.model = model;
    this.browserHandles = browserHandles;
    this.llm = llm;
    this.tools = tools;
    this.getContext = getContext;
    this.fetchImpl = fetchImpl;
  }

  /**
   * Async construction: engine resolution may need to probe the Cache API
   * (two-pass transformers -> Gemini Nano fallback), so construction goes
   * through this factory instead of a synchronous constructor.
   */
  static async create(
    llm: LlmSection,
    tools: AgentToolExecutors,
    getContext: () => SessionContext,
    fetchImpl?: typeof fetch,
  ): Promise<ClientAgent> {
    const built = await resolveBrowserLlm(llm, { fetchImpl });
    if (!built) {
      throw new Error("in-browser llm engine unsupported in this browser");
    }
    // Browser engines construct lazily: load() instantiates the underlying
    // model (and waits for weights to be ready) before the getter is read.
    // Skipping this makes `this.model = model` in the constructor throw
    // "browser llm not loaded yet" on the first agent turn.
    await built.browser?.load();
    return new ClientAgent(built.model, built.browser ?? null, llm, tools, getContext, fetchImpl);
  }

  /** Full transcript so far (for persistence/report). */
  get messages(): ChatMsg[] {
    return this.history;
  }
  reset(): void {
    this.history = [];
    this.rollingSummary = "";
  }

  /**
   * Context-rot control for small in-browser models: keep the static head
   * (system prompt + resume/JD, sent via `system`), the rolling summary of
   * evicted turns, and the last WINDOW messages verbatim. Remote providers
   * with big windows still benefit from shorter prompts; behavior is
   * identical for the first WINDOW messages.
   */
  private windowedMessages(): ChatMsg[] {
    if (this.history.length <= WINDOW_MESSAGES) return this.history;
    const window = this.history.slice(-WINDOW_MESSAGES);
    const evicted = this.history.slice(0, this.history.length - WINDOW_MESSAGES);
    if (this.rollingSummary) {
      return [
        { role: "user", content: `[earlier conversation summary]\n${this.rollingSummary}` },
        { role: "assistant", content: "Understood, continuing." },
        ...window,
      ];
    }
    // No summary yet: degrade gracefully to a plain truncation notice.
    return [
      { role: "user", content: `[${evicted.length} earlier messages omitted]` },
      { role: "assistant", content: "Understood, continuing." },
      ...window,
    ];
  }

  /**
   * Fold the turns that are about to fall out of the window into the rolling
   * summary. Uses the same model; on failure the caller keeps turns verbatim
   * (capped by the hard window) and retries on the next turn.
   */
  async compact(): Promise<void> {
    if (this.history.length <= WINDOW_MESSAGES + COMPACT_BATCH) return;
    const evictCount = this.history.length - WINDOW_MESSAGES;
    const evicted = this.history.slice(0, evictCount);
    const transcript = evicted.map((m) => `${m.role}: ${m.content}`).join("\n");
    const prompt = [
      "Summarize the following interview excerpt. Keep: candidate answers,",
      "strengths, weaknesses, specific claims, open threads. Be concise",
      "(max 200 words). Existing summary to merge (may be empty):",
      this.rollingSummary || "(none)",
      "",
      "Excerpt:",
      transcript,
    ].join("\n");
    const { generateText } = await import("ai");
    const { text } = await generateText({ model: this.model, prompt });
    const clean = stripThink(text).trim();
    if (clean) {
      this.rollingSummary = clean;
      this.history = this.history.slice(evictCount);
    }
  }

  /**
   * One user turn: append the user message, then run streamText with the
   * three tools. onText fires for every assistant text delta of the final
   * answer. Resolves with the full final text.
   */
  async respond(userText: string, opts: RespondOptions = {}): Promise<string> {
    this.history.push({ role: "user", content: userText });
    const onError = opts.onError ?? defaultOnError;
    const { streamText, jsonSchema, stepCountIs, NoSuchToolError, InvalidToolInputError } =
      await import("ai");
    const t0 = Date.now();
    let llmTtftMs: number | undefined;
    const result = streamText({
      model: this.model,
      system: buildPrompt(this.getContext()),
      messages: this.windowedMessages().map((m) => ({
        role: m.role,
        content: m.content,
      })),
      tools: {
        update_question: {
          description: toolDef("update_question").description,
          inputSchema: jsonSchema(
            toJsonSchema(
              v.object({
                question: v.string(),
                hints: v.optional(v.array(v.string()), []),
              }),
            ),
          ),
          execute: async (input: { question: string; hints?: string[] }) =>
            this.tools.update_question({
              question: input.question,
              hints: input.hints,
            }),
        },
        read_editor: {
          description: toolDef("read_editor").description,
          inputSchema: jsonSchema(toJsonSchema(v.object({}))),
          execute: async () => this.tools.read_editor({}),
        },
        read_whiteboard: {
          description: toolDef("read_whiteboard").description,
          inputSchema: jsonSchema(toJsonSchema(v.object({}))),
          execute: async () => this.tools.read_whiteboard({}),
        },
      },
      abortSignal: opts.signal,
      maxOutputTokens: 512,
      stopWhen: stepCountIs(MAX_HOPS),
      onError: ({ error }: { error: unknown }) => {
        const phase: TurnPhase =
          NoSuchToolError.isInstance(error) || InvalidToolInputError.isInstance(error)
            ? "tool"
            : "llm";
        onError(error, phase);
      },
    });

    let full = "";
    const thinkFilter = new ThinkFilter();
    for await (const delta of result.textStream) {
      if (llmTtftMs === undefined) llmTtftMs = Date.now() - t0;
      const clean = thinkFilter.push(delta);
      if (!clean) continue;
      full += clean;
      opts.onText?.(clean);
    }
    const tail = thinkFilter.flush();
    if (tail) {
      full += tail;
      opts.onText?.(tail);
    }
    if (full.trim()) this.history.push({ role: "assistant", content: full });
    opts.onMetrics?.({
      vad_ms: 0,
      llm_ttft_ms: llmTtftMs,
      total_ms: Date.now() - t0,
    });
    // Fold aged-out turns into the rolling summary; a failed compaction is
    // non-fatal (the windowed view degrades to truncation) and is retried
    // on the next turn.
    try {
      await this.compact();
    } catch (error) {
      onError(error, "llm");
    }
    return full;
  }
}

/** Convenience executor set backed by the client stores (editor/whiteboard/question). */
export function createStoreToolExecutors(deps: {
  editorGetter: () => string;
  whiteboardGetter: () => string;
  onQuestion: (q: { text: string; hints: string[] }) => void;
}): AgentToolExecutors {
  return {
    async update_question(args) {
      deps.onQuestion({ text: args.question, hints: args.hints ?? [] });
      return "ok";
    },
    async read_editor() {
      const text = deps.editorGetter();
      return text.trim() ? text : "(editor is empty)";
    },
    async read_whiteboard() {
      const json = deps.whiteboardGetter();
      return describeWhiteboardSnapshot(json);
    },
  };
}
