import { describe, expect, it } from "vitest";
import { mockEmbed } from "../mock-provider/main";
import { chunkText } from "../../../apps/server/src/rag/parse";
import { retrieve } from "../../../apps/server/src/rag/embeddings";
import { cosineSimilarity } from "../../../apps/server/src/rag/cosine";

/**
 * RAG ingestion eval (golden set 1): doc -> chunks -> embeddings -> retrieval.
 * Uses the mock provider's deterministic embeddings, so expected rankings are
 * exact, not statistical.
 */

const DOC = `## distributed systems

The billing pipeline processes events through Kafka with at-least-once delivery.
Idempotency keys prevent double charges. Downstream consumers deduplicate by event id
before applying ledger mutations. Reconciliation jobs run nightly against the payment
gateway export and flag mismatches above one cent for manual review by the on-call
engineer. Out-of-order events are buffered in a reordering window keyed by account id.

## caching

We use a two-tier cache: local LRU backed by Redis. TTLs are 60 seconds for
hot keys. Cache stampedes are mitigated with request coalescing so that only one
origin fetch happens per key at a time. Negative results are cached briefly to
absorb repeated lookups for missing entities. Eviction metrics feed the capacity
dashboard and page when the hit rate drops below the weekly baseline.

## frontend

The dashboard is React with server-driven state. We render charts with SVG and
stream incremental updates over a websocket. The rendering layer is virtualized
so tables with tens of thousands of rows stay responsive on modest laptops.

## machine learning

Model choice is driven by offline evaluation on a held-out week of data.
Data hygiene checks run before every training job and block the pipeline on
schema drift, label leakage, or class-balance regressions beyond a set threshold.`;

describe("rag ingestion golden set", () => {
  const chunks = chunkText(DOC);

  it("splits the doc into multiple chunks", () => {
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("retrieves the caching chunk for a cache query", () => {
    const query = mockEmbed("how does caching and cache stampede mitigation work");
    const got = retrieve(
      query,
      chunks.map((text, i) => ({
        text,
        document_id: "doc1",
        document_name: "resume.md",
        seq: i,
        embedding: mockEmbed(text),
      })),
      1,
    );
    expect(got[0]!.text).toContain("cache");
    expect(got[0]!.score).toBeGreaterThan(0);
  });

  it("retrieves the billing chunk for a payments query", () => {
    const query = mockEmbed("tell me about billing idempotency and double charges");
    const got = retrieve(
      query,
      chunks.map((text, i) => ({
        text,
        document_id: "doc1",
        document_name: "resume.md",
        seq: i,
        embedding: mockEmbed(text),
      })),
      1,
    );
    expect(got[0]!.text).toContain("billing");
  });

  it("embeddings are deterministic and normalized", () => {
    expect(mockEmbed("kafka billing")).toEqual(mockEmbed("kafka billing"));
    const v = mockEmbed("kafka billing");
    expect(Math.abs(cosineSimilarity(v, v) - 1)).toBeLessThan(1e-9);
  });
});
