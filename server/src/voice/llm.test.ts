import { describe, it, expect } from "vitest";
import { OpenAiChatClient } from "./llm.ts";
import type { ToolDef } from "./llm.ts";

function fetchStub(handler: (url: string, init?: RequestInit) => Response): typeof fetch {
  return handler as unknown as typeof fetch;
}

const tools: ToolDef[] = [
  {
    name: "update_question",
    description: "Rewrite the current question",
    parameters: {
      type: "object",
      properties: { question: { type: "string" } },
    },
  },
];

describe("OpenAiChatClient.chat", () => {
  it("posts the OpenAI request shape and parses content", async () => {
    let captured: { url: string; body: any; headers: Record<string, string> } | undefined;
    const llm = new OpenAiChatClient({
      baseUrl: "http://fake.local/",
      model: "mock-llm",
      apiKey: "sk-test",
      fetchImpl: fetchStub((url, init) => {
        captured = {
          url,
          body: JSON.parse(String(init!.body)),
          headers: init!.headers as Record<string, string>,
        };
        return Response.json({
          choices: [
            {
              message: { role: "assistant", content: "Tell me about maps." },
              finish_reason: "stop",
            },
          ],
        });
      }),
    });
    const result = await llm.chat([
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ]);
    expect(result.content).toBe("Tell me about maps.");
    expect(result.toolCalls).toEqual([]);
    expect(captured!.url).toBe("http://fake.local/v1/chat/completions");
    expect(captured!.body).toEqual({
      model: "mock-llm",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ],
    });
    expect(captured!.headers.authorization).toBe("Bearer sk-test");
  });

  it("sends tool defs wrapped as {type:'function'} and parses tool calls", async () => {
    let captured: any;
    const llm = new OpenAiChatClient({
      baseUrl: "http://fake.local",
      model: "mock-llm",
      fetchImpl: fetchStub((_url, init) => {
        captured = JSON.parse(String(init!.body));
        return Response.json({
          choices: [
            {
              message: {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "update_question",
                      arguments: '{"question":"Q2?"}',
                    },
                  },
                ],
              },
            },
          ],
        });
      }),
    });
    const result = await llm.chat([{ role: "user", content: "next" }], tools);
    expect(captured.tools).toEqual([
      {
        type: "function",
        function: {
          name: "update_question",
          description: "Rewrite the current question",
          parameters: {
            type: "object",
            properties: { question: { type: "string" } },
          },
        },
      },
    ]);
    expect(result.toolCalls).toEqual([{ name: "update_question", args: { question: "Q2?" } }]);
  });

  it("omits the tools key when no tools are given, tolerates unparseable args", async () => {
    let captured: any;
    const llm = new OpenAiChatClient({
      baseUrl: "http://fake.local",
      model: "mock-llm",
      fetchImpl: fetchStub((_url, init) => {
        captured = JSON.parse(String(init!.body));
        return Response.json({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "c",
                    type: "function",
                    function: { name: "x", arguments: "not-json{" },
                  },
                ],
              },
            },
          ],
        });
      }),
    });
    const result = await llm.chat([{ role: "user", content: "hi" }]);
    expect(captured.tools).toBeUndefined();
    expect(result.toolCalls[0]!.args).toEqual({ _raw: "not-json{" });
  });

  it("emits llm.request/llm.result events and throws on error status", async () => {
    const events: { type: string; payload?: unknown }[] = [];
    const sink = {
      postEvent: async (_s: string, type: string, payload?: unknown) =>
        void events.push({ type, payload }),
    };
    const ok = new OpenAiChatClient({
      baseUrl: "http://fake.local",
      model: "m",
      fetchImpl: fetchStub(() => Response.json({ choices: [{ message: { content: "hey" } }] })),
      events: sink,
      sessionId: "s1",
    });
    await ok.chat([{ role: "user", content: "x" }], tools);
    expect(events.map((e) => e.type)).toEqual(["llm.request", "llm.result"]);
    expect(events[0]!.payload).toEqual({ message_count: 1, tool_count: 1 });
    expect(events[1]!.payload).toMatchObject({ text_length: 3, tool_calls: 0 });

    events.length = 0;
    const failing = new OpenAiChatClient({
      baseUrl: "http://fake.local",
      model: "m",
      fetchImpl: fetchStub(() => new Response("err", { status: 429 })),
      events: sink,
      sessionId: "s1",
    });
    await expect(failing.chat([{ role: "user", content: "x" }])).rejects.toThrow(/429/);
    expect(events.map((e) => e.type)).toEqual(["llm.request", "llm.failed"]);
  });
});

/** Build a Response with a ReadableStream of SSE chunks. */
function sseResponse(chunks: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
  });
}

describe("OpenAiChatClient.streamChat", () => {
  it("parses SSE content deltas, fires onFirstToken/onText, and requests stream:true", async () => {
    let captured: any;
    const llm = new OpenAiChatClient({
      baseUrl: "http://fake.local",
      model: "m",
      fetchImpl: fetchStub((_url, init) => {
        captured = JSON.parse(String(init!.body));
        return sseResponse([
          'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":" there."}}]}\n\n',
          "data: [DONE]\n\n",
        ]);
      }),
    });
    const firstTokens: number[] = [];
    const deltas: string[] = [];
    const result = await llm.streamChat([{ role: "user", content: "hi" }], undefined, {
      onFirstToken: () => firstTokens.push(1),
      onText: (d) => deltas.push(d),
    });
    expect(captured.stream).toBe(true);
    expect(result.content).toBe("Hello there.");
    expect(result.toolCalls).toEqual([]);
    expect(deltas).toEqual(["Hello", " there."]);
    expect(firstTokens).toHaveLength(1);
  });

  it("merges incremental tool_calls by index", async () => {
    const llm = new OpenAiChatClient({
      baseUrl: "http://fake.local",
      model: "m",
      fetchImpl: fetchStub(() =>
        sseResponse([
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"update_question","arguments":"{\\"quest"}}]}}]}\n\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ion\\":\\"Q2?\\"}"}}]}}]}\n\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"c2","function":{"name":"read_editor","arguments":"{}"}}]}}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      ),
    });
    const result = await llm.streamChat([{ role: "user", content: "next" }], tools);
    expect(result.toolCalls).toEqual([
      { name: "update_question", args: { question: "Q2?" } },
      { name: "read_editor", args: {} },
    ]);
  });

  it("falls back to buffered JSON when the response is not SSE", async () => {
    const deltas: string[] = [];
    const llm = new OpenAiChatClient({
      baseUrl: "http://fake.local",
      model: "m",
      fetchImpl: fetchStub(() =>
        Response.json({
          choices: [{ message: { role: "assistant", content: "buffered reply." } }],
        }),
      ),
    });
    const result = await llm.streamChat([{ role: "user", content: "hi" }], undefined, {
      onText: (d) => deltas.push(d),
    });
    expect(result.content).toBe("buffered reply.");
    expect(deltas).toEqual(["buffered reply."]);
  });

  it("emits llm.ttft_ms in the llm.result event payload", async () => {
    const events: { type: string; payload?: unknown }[] = [];
    const sink = {
      postEvent: async (_s: string, type: string, payload?: unknown) =>
        void events.push({ type, payload }),
    };
    const llm = new OpenAiChatClient({
      baseUrl: "http://fake.local",
      model: "m",
      fetchImpl: fetchStub(() =>
        sseResponse(['data: {"choices":[{"delta":{"content":"x"}}]}\n\n', "data: [DONE]\n\n"]),
      ),
      events: sink,
      sessionId: "s1",
    });
    await llm.streamChat([{ role: "user", content: "hi" }]);
    const result = events.find((e) => e.type === "llm.result")!;
    expect(result.payload).toMatchObject({
      stream: true,
      ttft_ms: expect.any(Number),
    });
  });
});

describe("OpenAiChatClient.chat anthropic flavor", () => {
  it("posts the Anthropic Messages shape to /v1/messages and maps text + tool_use blocks", async () => {
    let captured: { url: string; body: any; headers: Record<string, string> } | undefined;
    const llm = new OpenAiChatClient({
      baseUrl: "http://fake.local/",
      model: "claude-sonnet",
      apiKey: "ak-test",
      flavor: "anthropic",
      fetchImpl: fetchStub((url, init) => {
        captured = {
          url,
          body: JSON.parse(String(init!.body)),
          headers: init!.headers as Record<string, string>,
        };
        return Response.json({
          content: [
            { type: "text", text: "Maps are useful." },
            { type: "tool_use", id: "tu_1", name: "update_question", input: { question: "why?" } },
            { type: "text", text: " Done." },
          ],
        });
      }),
    });
    const result = await llm.chat(
      [
        { role: "system", content: "sys one" },
        { role: "system", content: "sys two" },
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
        { role: "user", content: "go" },
      ],
      tools,
    );
    expect(result.content).toBe("Maps are useful. Done.");
    expect(result.toolCalls).toEqual([{ name: "update_question", args: { question: "why?" } }]);
    expect(captured!.url).toBe("http://fake.local/v1/messages");
    expect(captured!.headers["x-api-key"]).toBe("ak-test");
    expect(captured!.headers["anthropic-version"]).toBe("2023-06-01");
    expect(captured!.body).toEqual({
      model: "claude-sonnet",
      max_tokens: 1024,
      system: "sys one\n\nsys two",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
        { role: "user", content: "go" },
      ],
      tools: [
        {
          name: "update_question",
          description: "Rewrite the current question",
          input_schema: tools[0]!.parameters,
        },
      ],
    });
  });

  it("falls back to buffered chat() in streamChat when flavor is anthropic", async () => {
    let calls = 0;
    const llm = new OpenAiChatClient({
      baseUrl: "http://fake.local/",
      model: "claude-sonnet",
      flavor: "anthropic",
      fetchImpl: fetchStub(() => {
        calls++;
        return Response.json({ content: [{ type: "text", text: "buffered" }] });
      }),
    });
    const result = await llm.streamChat([{ role: "user", content: "hi" }], undefined, {
      onText: (t) => t,
    });
    expect(calls).toBe(1);
    expect(result).toEqual({ content: "buffered", toolCalls: [] });
  });
});
