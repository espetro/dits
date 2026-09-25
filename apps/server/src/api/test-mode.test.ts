import { describe, expect, it } from "vitest";
import { deriveStalledAt } from "./test-mode.ts";

// Table-based coverage over the /v1/test/pipeline stalled_at derivation.
// Rows deliberately include: empty/missing chains, every non-terminal stage
// as the last one, the terminal stage, duplicate stages, and out-of-order /
// unexpected arrival sequences (the derivation only looks at the last
// element, so "out of order" here means whatever arrival order the events
// table actually returned it in — a caller bug upstream, not something this
// function is meant to detect, which the tests pin down explicitly).
describe("deriveStalledAt", () => {
  const cases: Array<{
    name: string;
    stages: string[];
    expected: string | null;
  }> = [
    { name: "no stages yet", stages: [], expected: null },
    {
      name: "only agent.started",
      stages: ["agent.started"],
      expected: "agent.started",
    },
    {
      name: "stuck after vad.speech_ended (stt never fired)",
      stages: ["agent.started", "vad.speech_ended"],
      expected: "vad.speech_ended",
    },
    {
      name: "stuck at stt.request (stt hung)",
      stages: ["agent.started", "vad.speech_ended", "stt.request"],
      expected: "stt.request",
    },
    {
      name: "stt failed: chain ends at stt.failed",
      stages: ["agent.started", "vad.speech_ended", "stt.request", "stt.failed"],
      expected: "stt.failed",
    },
    {
      name: "stuck at stt.result (llm never fired)",
      stages: ["stt.request", "stt.result"],
      expected: "stt.result",
    },
    {
      name: "stuck at llm.request (llm hung)",
      stages: ["stt.result", "llm.request"],
      expected: "llm.request",
    },
    {
      name: "stuck at llm.result (tts never fired)",
      stages: ["llm.request", "llm.result"],
      expected: "llm.result",
    },
    {
      name: "stuck at tts.request (tts hung)",
      stages: ["llm.result", "tts.request"],
      expected: "tts.request",
    },
    {
      name: "tts failed: chain ends at tts.failed",
      stages: ["tts.request", "tts.failed"],
      expected: "tts.failed",
    },
    {
      name: "reached terminal stage: not stalled",
      stages: [
        "agent.started",
        "vad.speech_ended",
        "stt.request",
        "stt.result",
        "llm.request",
        "llm.result",
        "tts.request",
        "tts.result",
      ],
      expected: null,
    },
    {
      name: "duplicate terminal stages (retries emit tts.result twice)",
      stages: ["tts.request", "tts.result", "tts.result"],
      expected: null,
    },
    {
      name: "duplicate non-terminal last stage (retry loop stuck on stt.request)",
      stages: ["stt.request", "stt.request", "stt.request"],
      expected: "stt.request",
    },
    {
      name: "trailing event after terminal (new turn starting a fresh pass)",
      stages: ["tts.result", "vad.speech_ended"],
      expected: "vad.speech_ended",
    },
    {
      name: "single terminal stage only",
      stages: ["tts.result"],
      expected: null,
    },
    {
      name: "out-of-order arrival (result before request, as the events table handed it back)",
      stages: ["stt.result", "stt.request"],
      expected: "stt.request",
    },
  ];

  it.each(cases)("$name -> $expected", ({ stages, expected }) => {
    expect(deriveStalledAt(stages)).toBe(expected);
  });
});
