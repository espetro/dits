/** Brute-force cosine similarity between two equal-length vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error(`length mismatch: ${a.length} vs ${b.length}`);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Top-k most similar vectors to the query, highest first. */
export function topK(
  query: number[],
  vectors: number[][],
  k: number,
): { index: number; score: number }[] {
  return vectors
    .map((v, index) => ({ index, score: cosineSimilarity(query, v) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, k);
}
