import { describe, expect, it } from "vitest";
import {
  VOICE_TOOLS,
  buildPrompt,
  cutSentences,
  describeWhiteboardSnapshot,
  voiceToolsFor,
} from "./interview-agent.ts";

describe("buildPrompt", () => {
  it("includes mode, plan and current question with hints", () => {
    const p = buildPrompt({
      mode: "coach",
      plan: "plan text",
      currentQuestion: "q",
      hints: ["h1", "h2"],
    });
    expect(p).toContain("Interview mode: coach.");
    expect(p).toContain("Interview plan:\nplan text");
    expect(p).toContain("Current question: q");
    expect(p).toContain("Answer evaluation hints: h1; h2");
  });

  it("lists documents when present", () => {
    const p = buildPrompt({
      mode: "interview",
      documents: [{ name: "cv.pdf", text: "ten years" }],
    });
    expect(p).toContain("[cv.pdf] ten years");
  });
});

describe("VOICE_TOOLS", () => {
  it("has the three interview tools with JSON schema parameters", () => {
    expect(VOICE_TOOLS.map((t) => t.name)).toEqual([
      "update_question",
      "read_editor",
      "read_whiteboard",
    ]);
    for (const t of VOICE_TOOLS) {
      expect((t.parameters as { type: string }).type).toBe("object");
    }
  });
});

describe("voiceToolsFor", () => {
  it("emits update_question + per-tool read defs for the session toolset", () => {
    expect(voiceToolsFor({ editor: "", srs: "" }).map((t) => t.name)).toEqual([
      "update_question",
      "read_editor",
      "read_srs",
    ]);
  });

  it("adds update_ defs for write/read-write tools only", () => {
    expect(voiceToolsFor({ editor: "", whiteboard: "" }).map((t) => t.name)).not.toContain(
      "update_editor",
    );
    const tools = voiceToolsFor({ whiteboard: "", scratch: "rw" });
    // scratch is not in TOOL_AGENT_ACCESS -> read-only default, no update_ def
    expect(tools.map((t) => t.name)).toEqual([
      "update_question",
      "read_whiteboard",
      "read_scratch",
    ]);
  });

  it("keeps only update_question for an empty toolset", () => {
    expect(voiceToolsFor({}).map((t) => t.name)).toEqual(["update_question"]);
  });
});

describe("describeWhiteboardSnapshot", () => {
  it("renders shapes, text and arrows compactly", () => {
    const json = JSON.stringify({
      shapes: [
        { type: "text", text: "load balancer" },
        { type: "arrow", from: "a", to: "b" },
      ],
    });
    expect(describeWhiteboardSnapshot(json)).toBe(
      'whiteboard: 2 shape(s)\n- text text="load balancer"\n- arrow from a to b',
    );
  });

  it("handles empty, unparseable and shapeless snapshots", () => {
    expect(describeWhiteboardSnapshot('{"shapes":[]}')).toBe("(empty whiteboard)");
    expect(describeWhiteboardSnapshot("not json")).toBe("(unparseable whiteboard snapshot)");
  });
});

describe("cutSentences", () => {
  it("cuts at terminal punctuation once min length is reached", () => {
    const { sentences, rest } = cutSentences("Hello there, how are you doing today? I am fine.");
    expect(sentences).toEqual(["Hello there, how are you doing today?"]);
    expect(rest).toBe(" I am fine.");
  });

  it("keeps short fragments pending", () => {
    const { sentences, rest } = cutSentences("Hi. Ok.");
    expect(sentences).toEqual([]);
    expect(rest).toBe("Hi. Ok.");
  });

  it("handles CJK terminals with trailing quotes, merging short fragments", () => {
    const { sentences, rest } = cutSentences(
      '这是一个足够长的句子,用来测试中文分句。短."And this one is long enough!"',
    );
    expect(sentences).toEqual([
      '这是一个足够长的句子,用来测试中文分句。短."And this one is long enough!"',
    ]);
    expect(rest).toBe("");
  });
});
