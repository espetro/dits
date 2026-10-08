import { describe, expect, it, vi } from "vitest";

interface StreamProto {
  [key: symbol]: unknown;
}

const proto = ReadableStream.prototype as unknown as StreamProto;

function streamOf(...chunks: string[]): ReadableStream<string> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

describe("readable stream asyncIterator polyfill", () => {
  it("leaves a native implementation untouched", async () => {
    const native = proto[Symbol.asyncIterator];
    expect(typeof native).toBe("function");
    vi.resetModules();
    await import("./readable-async-iterator");
    expect(proto[Symbol.asyncIterator]).toBe(native);
  });

  it("installs a working for-await path when the method is missing", async () => {
    const native = proto[Symbol.asyncIterator];
    try {
      delete proto[Symbol.asyncIterator];
      vi.resetModules();
      await import("./readable-async-iterator");
      expect(typeof proto[Symbol.asyncIterator]).toBe("function");

      const got: string[] = [];
      for await (const chunk of streamOf("a", "b", "c")) got.push(chunk);
      expect(got).toEqual(["a", "b", "c"]);
    } finally {
      if (native) proto[Symbol.asyncIterator] = native;
    }
  });
});
