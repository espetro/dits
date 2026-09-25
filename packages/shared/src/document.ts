import * as v from "valibot";

export const DocumentIdSchema = v.pipe(v.string(), v.uuid());
export type DocumentId = v.InferOutput<typeof DocumentIdSchema>;

/** Text-only ingestion in v1: pdf, md, txt, docx. */
export const DocumentKindSchema = v.picklist(["pdf", "md", "txt", "docx"]);
export type DocumentKind = v.InferOutput<typeof DocumentKindSchema>;

export const DocumentStatusSchema = v.picklist(["pending", "processing", "ready", "failed"]);
export type DocumentStatus = v.InferOutput<typeof DocumentStatusSchema>;

export const DocumentSchema = v.object({
  id: DocumentIdSchema,
  session_id: v.pipe(v.string(), v.uuid()),
  name: v.pipe(v.string(), v.minLength(1)),
  kind: DocumentKindSchema,
  size_bytes: v.pipe(v.number(), v.integer(), v.minValue(0)),
  status: DocumentStatusSchema,
  /** populated when status is "failed" */
  error: v.optional(v.string()),
  chunk_count: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
  /** ISO 8601 */
  created_at: v.pipe(v.string(), v.isoTimestamp()),
});
export type Document = v.InferOutput<typeof DocumentSchema>;

/** Ingestion caps, enforced server-side and surfaced in the file-drop UI. */
export const DOCUMENT_CAPS = {
  maxFiles: 10,
  maxTotalBytes: 20 * 1024 * 1024,
} as const;

export const CHUNK_SIZE = 1000;
export const CHUNK_OVERLAP = 150;

/** A stored chunk with its embedding already consumed; embeddings are never returned over the wire. */
export const ChunkSchema = v.object({
  id: v.pipe(v.string(), v.uuid()),
  document_id: DocumentIdSchema,
  session_id: v.pipe(v.string(), v.uuid()),
  seq: v.pipe(v.number(), v.integer(), v.minValue(0)),
  text: v.string(),
});
export type Chunk = v.InferOutput<typeof ChunkSchema>;

export const RetrievedChunkSchema = v.object({
  document_id: DocumentIdSchema,
  document_name: v.string(),
  seq: v.pipe(v.number(), v.integer(), v.minValue(0)),
  text: v.string(),
  score: v.pipe(v.number(), v.minValue(-1), v.maxValue(1)),
});
export type RetrievedChunk = v.InferOutput<typeof RetrievedChunkSchema>;

export const SessionContextResponseSchema = v.object({
  chunks: v.array(RetrievedChunkSchema),
});
export type SessionContextResponse = v.InferOutput<typeof SessionContextResponseSchema>;

/** OpenAI-compatible /v1/embeddings response shapes we depend on. */
export const EmbeddingResponseSchema = v.object({
  data: v.array(
    v.object({
      embedding: v.array(v.number()),
      index: v.optional(v.number()),
    }),
  ),
});
