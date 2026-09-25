import { describe, expect, it, vi } from "vitest";
import { createOpenAiCompatibleModel } from "./openai-compatible-provider";

const PROFILE = {
  baseUrl: "http://t.local/v1",
  apiKey: "sk-x",
  model: "m1",
};

function sseResponse(chunks: unknown[]): Response {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
  });
}

const PROMPT = [
  { role: "system" as const, content: "sys" },
  { role: "user" as const, content: [{ type: "text" as const, text: "hi" }] },
];

describe("openai-compatible provider", () => {
  it("streams text deltas and finish stop", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        sseResponse([
          { choices: [{ delta: { content: "Hel" } }] },
          { choices: [{ delta: { content: "lo." } }] },
          { usage: { prompt_tokens: 3, completion_tokens: 2 } },
        ]),
      );
    const model = createOpenAiCompatibleModel(PROFILE, {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const { stream } = await model.doStream({
      prompt: PROMPT,
      tools: undefined,
    } as never);
    const parts: any[] = [];
    for await (const p of stream) parts.push(p);

    expect(fetchMock.mock.calls[0]![0]).toBe("http://t.local/v1/chat/completions");
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.stream).toBe(true);
    expect(body.messages[0]).toEqual({ role: "system", content: "sys" });

    const deltas = parts.filter((p) => p.type === "text-delta").map((p) => p.delta);
    expect(deltas.join("")).toBe("Hello.");
    const finish = parts.find((p) => p.type === "finish");
    expect(finish.finishReason.unified).toBe("stop");
    expect(finish.usage.inputTokens.total).toBe(3);
  });

  it("accumulates streamed tool calls into tool-call parts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "c1",
                    function: { name: "read_editor", arguments: "" },
                  },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, function: { arguments: "{}" } }],
              },
            },
          ],
        },
      ]),
    );
    const model = createOpenAiCompatibleModel(PROFILE, {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const { stream } = await model.doStream({ prompt: PROMPT } as never);
    const parts: any[] = [];
    for await (const p of stream) parts.push(p);

    const call = parts.find((p) => p.type === "tool-call");
    expect(call).toMatchObject({
      toolCallId: "c1",
      toolName: "read_editor",
      input: "{}",
    });
    expect(parts.find((p) => p.type === "finish").finishReason.unified).toBe("tool-calls");
  });

  it("sends tools with json schemas and auth header", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse([{ choices: [{ delta: { content: "ok" } }] }]));
    const model = createOpenAiCompatibleModel(PROFILE, {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await model.doStream({
      prompt: PROMPT,
      tools: [
        {
          type: "function" as const,
          name: "read_editor",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    } as never);
    const init = fetchMock.mock.calls[0]![1];
    expect(init.headers.authorization).toBe("Bearer sk-x");
    const body = JSON.parse(init.body);
    expect(body.tools[0].function.name).toBe("read_editor");
  });

  it("throws on non-ok response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    const model = createOpenAiCompatibleModel(PROFILE, {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await expect(model.doStream({ prompt: PROMPT } as never)).rejects.toThrow("500");
  });

  it("doGenerate parses a buffered completion", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "hi there" } }],
          usage: { prompt_tokens: 1, completion_tokens: 2 },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    const model = createOpenAiCompatibleModel(PROFILE, {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const out = await model.doGenerate({ prompt: PROMPT } as never);
    expect(out.content).toEqual([{ type: "text", text: "hi there" }]);
    expect(out.finishReason.unified).toBe("stop");
    expect(out.usage.outputTokens.total).toBe(2);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.stream).toBeUndefined();
  });

  it("doGenerate surfaces tool calls", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "c9",
                    type: "function",
                    function: {
                      name: "update_question",
                      arguments: '{"question":"q"}',
                    },
                  },
                ],
              },
            },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    const model = createOpenAiCompatibleModel(PROFILE, {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const out = await model.doGenerate({ prompt: PROMPT } as never);
    expect(out.finishReason.unified).toBe("tool-calls");
    expect((out.content as any[]).find((c) => c.type === "tool-call")).toBeTruthy();
  });

  it("maps assistant tool results back to tool role messages", async () => {
    let seen: any;
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: any) => {
      seen = JSON.parse(init.body);
      return sseResponse([{ choices: [{ delta: { content: "ok" } }] }]);
    });
    const model = createOpenAiCompatibleModel(PROFILE, {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const prompt: any = [
      ...PROMPT,
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "c1",
            toolName: "read_editor",
            input: "{}",
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c1",
            toolName: "read_editor",
            output: { content: "(editor is empty)" },
          },
        ],
      },
    ];
    await model.doStream({ prompt } as never);
    const toolMsg = seen.messages.find((m: any) => m.role === "tool");
    expect(toolMsg.tool_call_id).toBe("c1");
    expect(toolMsg.content).toContain("editor is empty");
  });
});
