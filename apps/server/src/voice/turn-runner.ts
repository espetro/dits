import { VOICE_TOOLS, buildPrompt } from "@di/shared";
import type { SessionContext, Turn, TurnMetrics, VoiceServerMessage } from "@di/shared";
import type { LlmMessage, LlmPort, LlmResult, ToolDef } from "./llm/index.ts";
import { SentenceSpeechPipeline, speakBuffered } from "./speech-pipeline.ts";
import type { ToolExecutor } from "./tools.ts";
import type { TtsPort } from "./tts/index.ts";

/** Max llm round-trips per reply (tool hops included). */
const MAX_HOPS = 4;

export interface TurnRunnerDeps {
  llm: LlmPort;
  tts: TtsPort;
  tools: ToolExecutor;
  send: (msg: VoiceServerMessage) => void;
  sendBinary: (data: Uint8Array) => void;
  persistTurn: (
    speaker: "user" | "agent",
    text: string,
    source?: "voice" | "text",
  ) => Promise<Turn>;
}

/**
 * Persist the user turn, run the LLM (executing tool calls), then persist and
 * speak the agent reply. Owns the conversation state (history, session
 * context, toolset); the loop seeds it on start().
 */
export class TurnRunner {
  ctx: SessionContext = { mode: "interview" };
  history: LlmMessage[] = [];
  /** Toolset from the session row; falls back to the default pair. */
  voiceTools: ToolDef[] = VOICE_TOOLS;

  constructor(private readonly deps: TurnRunnerDeps) {}

  async runAgentReply(
    text: string,
    source: "voice" | "text",
    signal: AbortSignal,
    metrics: TurnMetrics,
  ): Promise<void> {
    const { llm, send, persistTurn } = this.deps;
    const userTurn = await persistTurn("user", text, source);
    send({ t: "user_transcript", turn: userTurn });
    this.history.push({ role: "user", content: text });

    if (llm.streamChat) {
      await this.runStreamingSpeechTurn(signal, metrics);
      return;
    }
    const reply = await this.runLlmTurn(signal, metrics);

    const agentTurn = await persistTurn("agent", reply.content, "voice");
    this.history.push({ role: "assistant", content: reply.content });
    send({ t: "agent_transcript", turn: agentTurn });

    if (reply.content.trim() === "") return;
    await speakBuffered({
      tts: this.deps.tts,
      text: reply.content,
      signal,
      metrics,
      send,
      sendBinary: this.deps.sendBinary,
    });
  }

  private initialMessages(): LlmMessage[] {
    return [{ role: "system", content: buildPrompt(this.ctx) }, ...this.history];
  }

  /** Run the tool calls of one hop and append the assistant + tool messages. */
  private async appendToolHop(
    messages: LlmMessage[],
    hop: number,
    result: LlmResult,
  ): Promise<void> {
    const toolResults: { name: string; output: string }[] = [];
    for (const call of result.toolCalls) {
      toolResults.push({
        name: call.name,
        output: await this.deps.tools.execute(call.name, call.args),
      });
    }
    messages.push({
      role: "assistant",
      content: result.content,
      tool_calls: result.toolCalls.map((c, i) => ({
        id: `call_${hop}_${i}`,
        name: c.name,
        arguments: JSON.stringify(c.args),
      })),
    });
    for (const [i, tr] of toolResults.entries()) {
      messages.push({
        role: "tool",
        content: tr.output,
        tool_call_id: `call_${hop}_${i}`,
      });
    }
  }

  /** One LLM round-trip, executing tool calls until a plain reply comes back. */
  private async runLlmTurn(
    signal: AbortSignal,
    metrics?: TurnMetrics,
  ): Promise<{ content: string }> {
    const messages = this.initialMessages();
    const llmStart = Date.now();
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      const result = await this.deps.llm.chat(messages, this.voiceTools, { signal });
      if (metrics && metrics.llm_ttft_ms === undefined) metrics.llm_ttft_ms = Date.now() - llmStart;
      if (result.toolCalls.length === 0) return { content: result.content };
      await this.appendToolHop(messages, hop, result);
    }
    return { content: "" };
  }

  /**
   * Streaming turn: pipes LLM text deltas through the shared sentence cutter
   * into pipelined per-sentence TTS, so synthesis of sentence N+1 overlaps
   * with sending sentence N's audio. The agent turn is persisted with the
   * full reply once the stream completes. Tool-call hops drop any streamed
   * provisional speech and retry buffered (tools need the full result).
   */
  private async runStreamingSpeechTurn(signal: AbortSignal, metrics?: TurnMetrics): Promise<void> {
    const { llm, tts, send, sendBinary, persistTurn } = this.deps;
    const messages = this.initialMessages();
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      const llmStart = Date.now();
      const pipe = new SentenceSpeechPipeline({ tts, send, sendBinary, signal, metrics });
      const result = await llm.streamChat!(messages, this.voiceTools, {
        signal,
        onFirstToken: () => {
          if (metrics && metrics.llm_ttft_ms === undefined)
            metrics.llm_ttft_ms = Date.now() - llmStart;
        },
        onText: (delta) => pipe.push(delta),
      });
      if (result.toolCalls.length === 0) {
        pipe.flush();
        try {
          await pipe.drain();
        } finally {
          pipe.finishSpeaking();
        }
        if (result.content.trim() === "") return;
        const agentTurn = await persistTurn("agent", result.content);
        this.history.push({ role: "assistant", content: result.content });
        send({ t: "agent_transcript", turn: agentTurn });
        return;
      }
      // Tool hop: text streamed alongside tool calls is provisional; drop it.
      pipe.abandon();
      await this.appendToolHop(messages, hop, result);
    }
  }
}
