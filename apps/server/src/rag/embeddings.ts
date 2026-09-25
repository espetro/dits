import { EmbeddingResponseSchema } from "@di/shared";
import type { RetrievedChunk } from "@di/shared";
import * as v from "valibot";
import { cosineSimilarity } from "./cosine";

/** OpenAI-compatible embeddings client. */
export class EmbeddingClient {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly apiKey?: string,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch(new URL("/v1/embeddings", this.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) {
      throw new Error(`embeddings request failed: ${res.status} ${await res.text()}`);
    }
    const parsed = v.parse(EmbeddingResponseSchema, await res.json());
    const sorted = [...parsed.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return sorted.map((d) => d.embedding);
  }
}

/** Brute-force cosine retrieval (see .agents/notes/2026-09-04-sqlite-vec-spike.md). */
export function retrieve(
  query: number[],
  rows: {
    text: string;
    document_id: string;
    document_name: string;
    seq: number;
    embedding: number[];
  }[],
  k: number,
): RetrievedChunk[] {
  return rows
    .map((r) => ({
      document_id: r.document_id,
      document_name: r.document_name,
      seq: r.seq,
      text: r.text,
      score: cosineSimilarity(query, r.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
