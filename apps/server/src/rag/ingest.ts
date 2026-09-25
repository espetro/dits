import type { Db } from "../store/db";
import { chunkText, kindForName, parseDocument } from "./parse";
import { EmbeddingClient } from "./embeddings";
import { DOCUMENT_CAPS, DocumentSchema } from "@di/shared";
import type { Document, DocumentKind } from "@di/shared";
import * as v from "valibot";

export interface IngestOptions {
  embeddings: EmbeddingClient | undefined;
}

export class CapError extends Error {
  constructor(
    message: string,
    readonly status: 413 | 415 | 503 = 413,
  ) {
    super(message);
  }
}

/** Ingest uploaded files for a session: parse, chunk, embed, store. */
export async function ingestDocuments(
  db: Db,
  sessionId: string,
  files: { name: string; bytes: Uint8Array }[],
  opts: IngestOptions,
): Promise<Document[]> {
  const existing = await listDocuments(db, sessionId);
  if (existing.length + files.length > DOCUMENT_CAPS.maxFiles) {
    throw new CapError(
      `file cap exceeded: ${existing.length} existing + ${files.length} new > ${DOCUMENT_CAPS.maxFiles}`,
    );
  }
  const totalNew = files.reduce((n, f) => n + f.bytes.length, 0);
  const totalExisting = existing.reduce((n, d) => n + d.size_bytes, 0);
  if (totalExisting + totalNew > DOCUMENT_CAPS.maxTotalBytes) {
    throw new CapError(
      `size cap exceeded: ${totalExisting + totalNew} > ${DOCUMENT_CAPS.maxTotalBytes} bytes`,
    );
  }
  if (!opts.embeddings) {
    throw new CapError(
      "no embeddings provider configured (config.embeddings); cannot ingest documents",
      503,
    );
  }

  const out: Document[] = [];
  for (const file of files) {
    const kind = kindForName(file.name);
    if (!kind) throw new CapError(`unsupported file type: ${file.name}`, 415);
    const doc: Document = {
      id: crypto.randomUUID(),
      session_id: sessionId,
      name: file.name,
      kind,
      size_bytes: file.bytes.length,
      status: "processing",
      created_at: new Date().toISOString(),
    };
    await db
      .insertInto("documents")
      .values({ ...doc, error: null, chunk_count: null })
      .execute();
    out.push(doc);

    try {
      const text = await parseDocument(kind, file.bytes);
      const chunks = chunkText(text);
      const vectors = await opts.embeddings.embed(chunks);
      await db.transaction().execute(async (tx) => {
        for (let i = 0; i < chunks.length; i++) {
          await tx
            .insertInto("chunks")
            .values({
              id: crypto.randomUUID(),
              document_id: doc.id,
              session_id: sessionId,
              seq: i,
              text: chunks[i]!,
              embedding: new Uint8Array(Float32Array.from(vectors[i]!).buffer),
            })
            .execute();
        }
        await tx
          .updateTable("documents")
          .set({ status: "ready", chunk_count: chunks.length })
          .where("id", "=", doc.id)
          .execute();
      });
      doc.status = "ready";
      doc.chunk_count = chunks.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .updateTable("documents")
        .set({ status: "failed", error: message })
        .where("id", "=", doc.id)
        .execute();
      doc.status = "failed";
      doc.error = message;
    }
  }
  return out;
}

export async function listDocuments(db: Db, sessionId: string): Promise<Document[]> {
  const rows = await db
    .selectFrom("documents")
    .selectAll()
    .where("session_id", "=", sessionId)
    .orderBy("created_at")
    .execute();
  return rows.map((r) =>
    v.parse(DocumentSchema, r.error === null ? { ...r, error: undefined } : r),
  );
}

export async function deleteDocument(
  db: Db,
  sessionId: string,
  documentId: string,
): Promise<boolean> {
  const doc = await db
    .selectFrom("documents")
    .select("id")
    .where("id", "=", documentId)
    .where("session_id", "=", sessionId)
    .executeTakeFirst();
  if (!doc) return false;
  await db.transaction().execute(async (tx) => {
    await tx.deleteFrom("chunks").where("document_id", "=", documentId).execute();
    await tx.deleteFrom("documents").where("id", "=", documentId).execute();
  });
  return true;
}

/** Read chunks + embeddings for ready documents of a session. */
export async function loadVectors(
  db: Db,
  sessionId: string,
): Promise<
  {
    text: string;
    document_id: string;
    document_name: string;
    seq: number;
    embedding: number[];
  }[]
> {
  const rows = await db
    .selectFrom("chunks")
    .innerJoin("documents", "documents.id", "chunks.document_id")
    .select([
      "chunks.text",
      "chunks.seq",
      "chunks.embedding",
      "chunks.document_id",
      "documents.name as document_name",
    ])
    .where("chunks.session_id", "=", sessionId)
    .where("documents.status", "=", "ready")
    .execute();
  return rows.map((r) => ({
    text: r.text,
    document_id: r.document_id,
    document_name: r.document_name,
    seq: r.seq,
    embedding: Array.from(new Float32Array(r.embedding.buffer)),
  }));
}

export function embeddingsClientFromConfig(
  cfg: { base_url: string; api_key?: string; model: string } | undefined,
): EmbeddingClient | undefined {
  return cfg ? new EmbeddingClient(cfg.base_url, cfg.model, cfg.api_key) : undefined;
}

export type { DocumentKind };
