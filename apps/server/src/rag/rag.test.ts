import { describe, expect, it } from "vitest";
import { chunkText, kindForName } from "./parse";
import { retrieve } from "./embeddings";
import { CapError } from "./ingest";

describe("chunkText", () => {
  it("returns empty for empty input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  it("keeps a short text as a single chunk", () => {
    expect(chunkText("hello world")).toEqual(["hello world"]);
  });

  it("splits on paragraph boundaries near the size target", () => {
    const paragraphs = Array.from({ length: 20 }, (_, i) => `Paragraph ${i} ${"x".repeat(120)}`);
    const chunks = chunkText(paragraphs.join("\n\n"));
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1200);
  });

  it("is deterministic", () => {
    const text = Array.from({ length: 30 }, (_, i) => `para ${i} ${"y".repeat(200)}`).join("\n\n");
    expect(chunkText(text)).toEqual(chunkText(text));
  });

  it("splits a single oversized paragraph by sentence", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const chunks = chunkText(long);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 1200)).toBe(true);
  });
});

describe("kindForName", () => {
  it("maps extensions", () => {
    expect(kindForName("a.PDF")).toBe("pdf");
    expect(kindForName("notes.md")).toBe("md");
    expect(kindForName("readme.markdown")).toBe("md");
    expect(kindForName("b.txt")).toBe("txt");
    expect(kindForName("c.docx")).toBe("docx");
    expect(kindForName("d.exe")).toBeUndefined();
  });
});

describe("retrieve", () => {
  const rows = [
    {
      text: "same",
      document_id: "d1",
      document_name: "a.md",
      seq: 0,
      embedding: [1, 0],
    },
    {
      text: "orthogonal",
      document_id: "d1",
      document_name: "a.md",
      seq: 1,
      embedding: [0, 1],
    },
    {
      text: "opposite",
      document_id: "d2",
      document_name: "b.md",
      seq: 0,
      embedding: [-1, 0],
    },
  ];

  it("ranks by cosine similarity", () => {
    const got = retrieve([1, 0], rows, 2);
    expect(got[0]!.text).toBe("same");
    expect(got[0]!.score).toBeCloseTo(1);
    expect(got[1]!.text).toBe("orthogonal");
    expect(got).toHaveLength(2);
  });

  it("respects k", () => {
    expect(retrieve([1, 0], rows, 1)).toHaveLength(1);
  });
});

describe("CapError", () => {
  it("defaults to 413", () => {
    expect(new CapError("too big")).toMatchObject({ status: 413 });
    expect(new CapError("no embeddings", 503).status).toBe(503);
  });
});
