import { CHUNK_OVERLAP, CHUNK_SIZE } from "@di/shared";
import type { DocumentKind } from "@di/shared";

/**
 * Deterministic paragraph-boundary chunker. Target ~CHUNK_SIZE chars with
 * CHUNK_OVERLAP tail overlap; never splits mid-sentence unless a single
 * paragraph exceeds the target.
 */
export function chunkText(text: string): string[] {
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
    if (p.length > CHUNK_SIZE) {
      flush();
      for (const piece of splitLong(p)) chunks.push(piece);
      continue;
    }
    if (current && current.length + p.length + 2 > CHUNK_SIZE) {
      flush();
      current = tailOverlap(chunks[chunks.length - 1]) + p;
    } else {
      current = current ? `${current}\n\n${p}` : p;
    }
  }
  flush();
  return chunks;
}

/** Carry the last sentence(s) of the previous chunk (up to CHUNK_OVERLAP chars) as overlap. */
function tailOverlap(prev: string | undefined): string {
  if (!prev) return "";
  const tail = prev.slice(-CHUNK_OVERLAP);
  const cut = tail.search(/[.!?]\s|\n/);
  return cut >= 0 && cut < tail.length - 1 ? `${tail.slice(cut + 1).trim()} ` : "";
}

function splitLong(p: string): string[] {
  const sentences = p.match(/[^.!?]+[.!?]*\s*/g) ?? [p];
  const out: string[] = [];
  let buf = "";
  for (const s of sentences) {
    if (buf.length + s.length > CHUNK_SIZE && buf) {
      out.push(buf.trim());
      buf = tailOverlap(out[out.length - 1]);
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
