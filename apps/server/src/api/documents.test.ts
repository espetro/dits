import { beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { apiRoutes } from "./routes";
import { createDatabase, migrate } from "../store/db";
import type { Db } from "../store/db";
import { EmbeddingClient } from "../rag/embeddings";

class StubEmbeddings extends EmbeddingClient {
  constructor() {
    super("http://embeddings.invalid", "mock-embed");
  }
  override async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      const vec = new Array(8).fill(0) as number[];
      vec[[...t].reduce((s, c) => s + c.charCodeAt(0), 0) % 8] = 1;
      return vec;
    });
  }
}

describe("document routes", () => {
  let db: Db;
  let app: Hono;
  let sessionId: string;

  beforeAll(async () => {
    db = createDatabase(":memory:");
    await migrate(db);
    app = new Hono();
    app.route("/v1", apiRoutes(db, { testMode: false, embeddings: new StubEmbeddings() }));
    const res = await app.request("/v1/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "t", mode: "interview", duration_min: 20 }),
    });
    sessionId = ((await res.json()) as { id: string }).id;
  });

  function upload(name: string, content: string): Promise<Response> {
    const form = new FormData();
    form.append("file", new File([content], name, { type: "text/plain" }));
    return Promise.resolve(
      app.request(`/v1/sessions/${sessionId}/documents`, {
        method: "POST",
        body: form,
      }),
    );
  }

  it("ingests a text document and returns it ready with chunk count", async () => {
    const res = await upload("notes.md", "# notes\n\nabout caching systems\n\nmore text here");
    expect(res.status).toBe(201);
    const { documents } = (await res.json()) as {
      documents: { name: string; status: string; chunk_count?: number }[];
    };
    expect(documents).toHaveLength(1);
    const doc = documents[0]!;
    expect(doc).toMatchObject({ name: "notes.md", status: "ready" });
    expect(doc.chunk_count).toBeGreaterThan(0);
  });

  it("rejects unsupported file types with 415", async () => {
    const res = await upload("evil.exe", "binary");
    expect(res.status).toBe(415);
  });

  it("returns 400 when no files are posted", async () => {
    const res = await app.request(`/v1/sessions/${sessionId}/documents`, {
      method: "POST",
      body: new FormData(),
    });
    expect(res.status).toBe(400);
  });

  it("lists documents and retrieves context chunks", async () => {
    const list = await app.request(`/v1/sessions/${sessionId}/documents`);
    const { documents } = (await list.json()) as { documents: unknown[] };
    expect(documents).toHaveLength(1);

    const ctx = await app.request(`/v1/sessions/${sessionId}/context`);
    expect(ctx.status).toBe(200);
    const { chunks } = (await ctx.json()) as {
      chunks: { document_name: string }[];
    };
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]).toMatchObject({ document_name: "notes.md" });
  });

  it("404s context for unknown sessions", async () => {
    const res = await app.request("/v1/sessions/00000000-0000-4000-8000-000000000000/context");
    expect(res.status).toBe(404);
  });

  it("deletes a document and its chunks", async () => {
    const { documents } = (await (
      await app.request(`/v1/sessions/${sessionId}/documents`)
    ).json()) as { documents: { id: string }[] };
    const res = await app.request(`/v1/sessions/${sessionId}/documents/${documents[0]!.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(204);
    const ctx = await app.request(`/v1/sessions/${sessionId}/context`);
    expect(((await ctx.json()) as { chunks: unknown[] }).chunks).toHaveLength(0);
  });
});
