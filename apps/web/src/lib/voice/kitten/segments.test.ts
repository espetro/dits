import { describe, expect, it } from "vitest";
import { splitClauses } from "./segments";

describe("splitClauses", () => {
  it("keeps an unpunctuated sentence whole", () => {
    expect(splitClauses("tell me about a time you led a team")).toEqual([
      "tell me about a time you led a team",
    ]);
  });

  it("splits on clause-final punctuation, keeping it attached", () => {
    expect(
      splitClauses("interesting answer, but can you tell me more about the tradeoffs?"),
    ).toEqual(["interesting answer,", "but can you tell me more about the tradeoffs?"]);
  });

  it("merges short leading fragments into the next segment", () => {
    expect(splitClauses("sure, tell me about a project you are proud of")).toEqual([
      "sure, tell me about a project you are proud of",
    ]);
  });

  it("merges a short trailing fragment into the previous segment", () => {
    expect(splitClauses("that is a really great answer overall, wow.")).toEqual([
      "that is a really great answer overall, wow.",
    ]);
  });

  it("splits question marks inside a longer utterance", () => {
    expect(splitClauses("why did you choose react? was it a tradeoff you weighed?")).toEqual([
      "why did you choose react?",
      "was it a tradeoff you weighed?",
    ]);
  });
});
