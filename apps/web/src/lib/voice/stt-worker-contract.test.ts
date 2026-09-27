import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// regression guard for the stt boot failure where the sherpa zipformer worker
// was spawned as a module worker: `self.importScripts` does not exist on
// module workers, so init threw and stt never reached ready. vite only emits
// a classic (importScripts-capable) bundle when the worker entry is free of
// static imports, so both invariants are asserted at the source level.
// vitest's cwd is apps/web; import.meta.url is not a file:// url here
const workerSrc = readFileSync(resolve("src/lib/voice/sherpa/stt-worker.ts"), "utf8");
const enginesSrc = readFileSync(resolve("src/lib/voice/wasm-engines.ts"), "utf8");

describe("sherpa stt worker contract", () => {
  it("stt-worker.ts has no static value imports (vite emits a classic bundle)", () => {
    const staticImports = workerSrc
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^import\s/.test(line) && !/^import\s+type\b/.test(line));
    expect(staticImports).toEqual([]);
  });

  it("loads the sherpa glue via importScripts", () => {
    expect(workerSrc).toContain("importScripts");
  });

  it("is spawned with type: classic in wasm-engines.ts", () => {
    const spawn = enginesSrc.match(
      /new Worker\(new URL\("\.\/sherpa\/stt-worker\.ts"[\s\S]*?\{[^}]*\}\)/,
    );
    expect(spawn?.[0]).toContain('"classic"');
    expect(spawn?.[0]).not.toContain('"module"');
  });
});
