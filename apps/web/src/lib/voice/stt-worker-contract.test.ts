import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// regression guard for the stt boot failures where the sherpa zipformer
// worker never reached ready: (1) spawned as a module worker, where
// `self.importScripts` does not exist; (2) the npm sherpa-onnx glue
// is nodejs-only (unconditional `require("path"|"fs"|"crypto")` +
// `NODERAWFS` throw outside node). the durable invariants: classic spawn,
// glue loaded via importScripts, no static sherpa-onnx import (its
// top-level vars must land on the worker global scope at runtime), and
// the vendored glue is the browser build with the stub .data patch.
// vitest's cwd is apps/web; import.meta.url is not a file:// url here
const workerSrc = readFileSync(resolve("src/lib/voice/sherpa/stt-worker.ts"), "utf8");
const apiSrc = readFileSync(resolve("src/lib/voice/sherpa/stt-api.ts"), "utf8");
const enginesSrc = readFileSync(resolve("src/lib/voice/wasm-engines.ts"), "utf8");
const glueSrc = readFileSync(resolve("public/sherpa/sherpa-onnx-wasm-main-asr.js"), "utf8");

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

  it("vendors the browser glue, not the nodejs one", () => {
    // nodejs-only markers the npm build carries; the browser glue keeps
    // every require() behind an isNode/ENVIRONMENT_IS_NODE guard
    expect(glueSrc).not.toContain("NODERAWFS");
    expect(glueSrc).not.toContain('require("path")');
  });

  it("vendored glue carries the stub .data metadata patch", () => {
    // scripts/repack-sherpa-stt.ts rewrites the embedded file-packager
    // metadata to a single stub file (the real model arrives via the
    // manifest + FS.writeFile)
    expect(glueSrc).toContain(
      'loadPackage({files:[{filename:"/.stub",start:0,end:1}],remote_package_size:1})',
    );
  });

  it("resolves asset urls from the vendored public dir, not the npm package", () => {
    expect(enginesSrc).not.toMatch(/from "sherpa-onnx\//);
    expect(enginesSrc).toContain("/sherpa/");
    expect(apiSrc).toContain("dataUrl");
  });
});
