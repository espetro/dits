/**
 * Clause-level segmentation for streamed synthesis: ort session.run is
 * monolithic, so the only way to emit pcm early is to synthesize smaller
 * pieces. Clauses are the natural split — boundary punctuation stays
 * attached so the phonemizer keeps the pause, and fragments shorter than
 * MIN_CLAUSE_CHARS merge forward (a tiny standalone ort run costs more
 * latency than it saves).
 */

const MIN_CLAUSE_CHARS = 16;

export function splitClauses(text: string): string[] {
  const parts = text.split(/(?<=[,;:!?—–])\s+/u);
  const segments: string[] = [];
  let acc = "";
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    acc = acc ? `${acc} ${trimmed}` : trimmed;
    if (acc.length >= MIN_CLAUSE_CHARS) {
      segments.push(acc);
      acc = "";
    }
  }
  if (acc) {
    const last = segments.length - 1;
    if (last >= 0) segments[last] = `${segments[last]} ${acc}`;
    else segments.push(acc);
  }
  return segments;
}
