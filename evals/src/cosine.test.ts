import { describe, expect, it } from "vitest";
import { cosineSimilarity, topK } from "./cosine";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it("is scale invariant", () => {
    expect(cosineSimilarity([1, 1], [5, 5])).toBeCloseTo(1);
  });

  it("returns 0 when a vector is zero", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it("throws on length mismatch", () => {
    expect(() => cosineSimilarity([1], [1, 2])).toThrow("length mismatch");
  });
});

describe("topK", () => {
  it("ranks by descending similarity", () => {
    const q = [1, 0];
    const result = topK(
      q,
      [
        [0, 1],
        [0.9, 0.1],
        [1, 0],
      ],
      2,
    );
    expect(result.map((r) => r.index)).toEqual([2, 1]);
  });

  it("respects k", () => {
    expect(
      topK(
        [1, 0],
        [
          [1, 0],
          [0, 1],
          [1, 1],
        ],
        1,
      ),
    ).toHaveLength(1);
  });
});
