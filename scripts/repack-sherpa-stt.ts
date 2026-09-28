#!/usr/bin/env bun
/**
 * Repack the official sherpa-onnx browser wasm build for vendoring.
 *
 * The npm package (sherpa-onnx@1.13.x) only ships the nodejs glue
 * (sherpa-onnx-wasm-nodejs.*: unconditional require("path"/"fs"/"crypto"),
 * NODERAWFS throw outside node) — it can never run in a browser worker.
 * The release tarball ships the browser glue
 * (sherpa-onnx-wasm-main-asr.js: requires are isNode-gated) plus a ~190MB
 * file-packager `.data` blob holding THEIR transducer model. We don't want
 * their model — our manifest already owns zipformer2-ctc bytes — so this
 * script patches the glue's embedded `loadPackage({files,remote_package_size})`
 * metadata to a single 1-byte stub and emits a stub `.data`. The wasm + the
 * tarball's own sherpa-onnx-asr.js are vendored verbatim.
 *
 * Usage:  bun scripts/repack-sherpa-stt.ts
 * Output: apps/web/public/sherpa/{sherpa-onnx-wasm-main-asr.js,
 *         sherpa-onnx-wasm-main-asr.wasm, sherpa-onnx-wasm-main-asr.data,
 *         sherpa-onnx-asr.js}
 */
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const VERSION = "v1.13.7";
const TARBALL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/${VERSION}/sherpa-onnx-wasm-simd-${VERSION}-en-asr-zipformer.tar.bz2`;
const DIR_NAME = `sherpa-onnx-wasm-simd-${VERSION}-en-asr-zipformer`;
const OUT_DIR = join(import.meta.dirname, "..", "apps", "web", "public", "sherpa");

const STUB_FILE = "/.stub";
const META_RE = /loadPackage\(\{files:\[[^\]]*\],remote_package_size:\d+\}\)/;

const work = mkdtempSync(join(tmpdir(), "sherpa-repack-"));
const tarball = join(work, "sherpa.tar.bz2");

console.log(`downloading ${TARBALL_URL}`);
const res = await fetch(TARBALL_URL);
if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);
writeFileSync(tarball, new Uint8Array(await res.arrayBuffer()));

for (const cmd of [["tar", "-xjf", tarball, "-C", work]]) {
  const r = spawnSync(cmd[0]!, cmd.slice(1), { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd[0]} exited ${r.status}`);
}

const src = join(work, DIR_NAME);
let glue = readFileSync(join(src, "sherpa-onnx-wasm-main-asr.js"), "utf8");

const before = glue.match(META_RE);
if (!before) throw new Error("metadata block not found in glue — upstream layout changed");
glue = glue.replace(
  META_RE,
  `loadPackage({files:[{filename:"${STUB_FILE}",start:0,end:1}],remote_package_size:1})`,
);

// sanity: the browser glue must keep all require() behind env guards
for (const needle of ["NODERAWFS", 'require("path")']) {
  if (glue.includes(needle)) throw new Error(`browser glue unexpectedly contains ${needle}`);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "sherpa-onnx-wasm-main-asr.js"), glue);
copyFileSync(
  join(src, "sherpa-onnx-wasm-main-asr.wasm"),
  join(OUT_DIR, "sherpa-onnx-wasm-main-asr.wasm"),
);
copyFileSync(join(src, "sherpa-onnx-asr.js"), join(OUT_DIR, "sherpa-onnx-asr.js"));
writeFileSync(join(OUT_DIR, "sherpa-onnx-wasm-main-asr.data"), new Uint8Array([0]));

console.log(`patched: ${before[0].slice(0, 80)}... -> stub (${STUB_FILE})`);
console.log(`vendored to ${OUT_DIR}`);
