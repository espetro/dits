import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// regression guard for the stt boot failure where the sherpa zipformer worker
// was spawned as a module worker: `self.importScripts` does not exist on
// module workers, so init threw and stt never reached ready. vite bundles a
// classic (importScripts-capable) iife when spawned `type: "classic"`, so the
// durable invariants are: classic spawn, glue loaded via importScripts, and no
// static sherpa-onnx import (the glue's top-level vars must land on the worker
// global scope at runtime, not inside the bundle).
// vitest's cwd is apps/web; import.meta.url is not a file:// url here
const workerSrc = readFileSync(resolve("src/lib/voice/sherpa/stt-worker.ts"), "utf8");
const apiSrc = readFileSync(resolve("src/lib/voice/sherpa/stt-api.ts"), "utf8");
const enginesSrc = readFileSync(resolve("src/lib/voice/wasm-engines.ts"), "utf8");

describe("sherpa stt worker contract", () => {
  it("is spawned with type: classic in wasm-engines.ts", () => {
    const spawn = enginesSrc.match(
      /new Worker\(new URL\("\.\/sherpa\/stt-worker\.ts"[\s\S]*?\{[^}]*\}\)/,
    );
    expect(spawn?.[0]).toContain('"classic"');
    expect(spawn?.[0]).not.toContain('"module"');
  });

  it("loads the sherpa glue via importScripts", () => {
    expect(workerSrc).toContain("importScripts");
  });

  it("never statically imports sherpa-onnx into the bundle", () => {
    for (const src of [workerSrc, apiSrc]) {
      const staticImports = src
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^import\s/.test(line) && !/^import\s+type\b/.test(line));
      expect(staticImports.filter((line) => line.includes("sherpa-onnx"))).toEqual([]);
    }
  });
});
