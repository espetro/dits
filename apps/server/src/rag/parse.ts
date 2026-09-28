import { CHUNK_OVERLAP, CHUNK_SIZE } from "@di/shared";
import type { DocumentKind } from "@di/shared";

export interface ChunkOptions {
  /** Target chunk size in chars (config.documents.chunk_size). */
  size?: number;
  /** Tail overlap carried into the next chunk (config.documents.chunk_overlap). */
  overlap?: number;
}

/**
 * Deterministic paragraph-boundary chunker. Target ~size chars with
 * overlap tail overlap; never splits mid-sentence unless a single
 * paragraph exceeds the target.
 */
export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  const size = opts.size ?? CHUNK_SIZE;
  const overlap = opts.overlap ?? CHUNK_OVERLAP;
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return [];

  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = "";
  };

  for (const p of paragraphs) {
    if (p.length > size) {
      flush();
      for (const piece of splitLong(p, size, overlap)) chunks.push(piece);
      continue;
    }
    if (current && current.length + p.length + 2 > size) {
      flush();
      current = tailOverlap(chunks[chunks.length - 1], overlap) + p;
    } else {
      current = current ? `${current}\n\n${p}` : p;
    }
  }
  flush();
  return chunks;
}

/** Carry the last sentence(s) of the previous chunk (up to `overlap` chars) as overlap. */
function tailOverlap(prev: string | undefined, overlap: number): string {
  if (!prev || overlap <= 0) return "";
  const tail = prev.slice(-overlap);
  const cut = tail.search(/[.!?]\s|\n/);
  return cut >= 0 && cut < tail.length - 1 ? `${tail.slice(cut + 1).trim()} ` : "";
}

function splitLong(p: string, size: number, overlap: number): string[] {
  const sentences = p.match(/[^.!?]+[.!?]*\s*/g) ?? [p];
  const out: string[] = [];
  let buf = "";
  for (const s of sentences) {
    if (buf.length + s.length > size && buf) {
      out.push(buf.trim());
      buf = tailOverlap(out[out.length - 1], overlap);
    }
    buf += s;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

const KIND_BY_EXT: Record<string, DocumentKind> = {
  pdf: "pdf",
  md: "md",
  markdown: "md",
  txt: "txt",
  docx: "docx",
};

export function kindForName(name: string): DocumentKind | undefined {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return KIND_BY_EXT[ext];
}

/** Extract plain text from raw bytes according to the document kind. */
export async function parseDocument(kind: DocumentKind, bytes: Uint8Array): Promise<string> {
  switch (kind) {
    case "txt":
    case "md":
      return new TextDecoder().decode(bytes);
    case "pdf": {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: Buffer.from(bytes) });
      try {
        return (await parser.getText()).text;
      } finally {
        await parser.destroy();
      }
    }
    case "docx": {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({
        buffer: Buffer.from(bytes),
      });
      return result.value;
    }
  }
}
