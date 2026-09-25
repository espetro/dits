import { describe, expect, it } from "vitest";
import { pruneSnapshot, serializeSnapshot } from "./whiteboard-store";

function doc(store: Record<string, unknown>) {
  return { document: { store } };
}

const shape = (id: string, type: string, props?: Record<string, unknown>) => ({
  typeName: "shape",
  id,
  type,
  props,
});
const binding = (fromId: string, toId: string, terminal: string) => ({
  typeName: "binding",
  fromId,
  toId,
  advertisedTerminal: terminal,
});

describe("pruneSnapshot", () => {
  it("extracts shapes with text and arrow endpoints", () => {
    const snap = pruneSnapshot(
      doc({
        s1: shape("shape:a", "text", { text: "API Gateway" }),
        s2: shape("shape:b", "geo", { color: "red" }),
        b1: binding("shape:c", "shape:a", "end"),
        s3: shape("shape:c", "arrow"),
      }),
      1000,
    );
    expect(snap.shapeCount).toBe(3);
    const arrow = snap.shapes.find((s) => s.id === "shape:c");
    expect(arrow?.to).toBe("shape:a");
    expect(snap.shapes.find((s) => s.id === "shape:a")?.text).toBe("API Gateway");
  });

  it("handles garbage input", () => {
    expect(pruneSnapshot(null).shapeCount).toBe(0);
    expect(pruneSnapshot({}).shapeCount).toBe(0);
  });
});

describe("serializeSnapshot", () => {
  it("emits compact json under budget", () => {
    const snap = pruneSnapshot(doc({ s1: shape("shape:a", "text", { text: "hello" }) }), 1);
    const json = serializeSnapshot(snap);
    expect(json).toContain("hello");
    expect(new TextEncoder().encode(json).byteLength).toBeLessThan(8 * 1024);
  });

  it("truncates huge boards instead of failing", () => {
    const store: Record<string, unknown> = {};
    for (let i = 0; i < 500; i++) {
      store[`s${i}`] = shape(`shape:${i}`, "text", {
        text: `shape number ${i} with some text`.repeat(4),
      });
    }
    const json = serializeSnapshot(pruneSnapshot(doc(store), 1));
    expect(new TextEncoder().encode(json).byteLength).toBeLessThanOrEqual(8 * 1024);
    expect(JSON.parse(json).truncated).toBe(true);
  });
});
