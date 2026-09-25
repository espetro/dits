/**
 * Whiteboard snapshot serialization.
 *
 * The tldraw store keeps far more than the interviewer ever needs (camera,
 * opacity, handles...). We prune a full getSnapshot() document down to shapes
 * the agent could reason about: id, type, text-ish props and arrow endpoints.
 * Pure functions only, so this is unit-testable without tldraw mounted.
 */

/** Wire format the agent's read_whiteboard tool renders to text. */
export interface WhiteboardSnapshot {
  at: number;
  shapeCount: number;
  shapes: WhiteboardShape[];
}

export interface WhiteboardShape {
  id: string;
  type: string;
  text?: string;
  from?: string;
  to?: string;
}

const MAX_JSON_BYTES = 8 * 1024;

interface RawShape {
  id?: unknown;
  type?: unknown;
  props?: Record<string, unknown> | undefined;
}

interface RawBinding {
  fromId?: unknown;
  toId?: unknown;
  advertisedTerminal?: unknown;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function isTextProp(key: string): boolean {
  return key === "text" || key === "rich_text" || key === "labelText" || key === "rawText";
}

export function pruneSnapshot(document: unknown, now = Date.now()): WhiteboardSnapshot {
  let store: Record<string, unknown> | undefined;
  for (const obj of [document, (document as { document?: unknown } | null)?.document]) {
    if (obj && typeof obj === "object" && "store" in (obj as Record<string, unknown>)) {
      store = (obj as Record<string, unknown>).store as Record<string, unknown>;
      break;
    }
  }

  const bindings: Record<string, { from?: string; to?: string }> = {};
  const shapes: WhiteboardShape[] = [];

  for (const record of Object.values(store ?? {})) {
    if (!record || typeof record !== "object") continue;
    const r = record as Record<string, unknown>;
    const typeName = asString(r.typeName);
    if (typeName === "binding") {
      const b = record as unknown as RawBinding;
      const from = asString(b.fromId);
      const to = asString(b.toId);
      const terminal = asString(b.advertisedTerminal);
      if (!from || !to) continue;
      const entry = (bindings[from] ??= {});
      if (terminal === "end") entry.to = to;
      else entry.from ??= to;
    } else if (typeName === "shape") {
      const s = record as unknown as RawShape;
      const id = asString(s.id);
      const type = asString(s.type);
      if (!id || !type) continue;
      const shape: WhiteboardShape = { id, type };
      const props = s.props;
      if (props && typeof props === "object") {
        for (const [key, value] of Object.entries(props)) {
          if (!isTextProp(key)) continue;
          const text = asString(value);
          if (text) {
            shape.text = text;
            break;
          }
        }
      }
      shapes.push(shape);
    }
  }

  for (const shape of shapes) {
    const bound = bindings[shape.id];
    if (!bound) continue;
    if (bound.from) shape.from = bound.from;
    if (bound.to) shape.to = bound.to;
  }

  const capped = shapes.slice(0, 200);
  return { at: now, shapeCount: shapes.length, shapes: capped };
}

export function serializeSnapshot(snapshot: WhiteboardSnapshot): string {
  let json = JSON.stringify(snapshot);
  if (new TextEncoder().encode(json).byteLength <= MAX_JSON_BYTES) return json;
  let shapes = snapshot.shapes;
  while (shapes.length > 0) {
    shapes = shapes.slice(0, Math.floor(shapes.length / 2));
    json = JSON.stringify({
      at: snapshot.at,
      shapeCount: snapshot.shapeCount,
      truncated: true,
      shapes,
    });
    if (new TextEncoder().encode(json).byteLength <= MAX_JSON_BYTES) return json;
  }
  return JSON.stringify({
    at: snapshot.at,
    shapeCount: snapshot.shapeCount,
    truncated: true,
    shapes: [],
  });
}
