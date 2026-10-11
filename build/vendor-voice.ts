/**
 * Build the builtin-voice vendor dir (build/vendor/voice/):
 *
 *   stt-worker.js / tts-worker.js     bun bundles (--target bun) of the
 *                                   server voice workers; spawned by
 *                                   absolute path — `bun build --compile`
 *                                   cannot embed workers.
 *   sherpa-onnx-wasm-nodejs.wasm      the emscripten blob the sherpa node
 *                                   glue reads relative to its own file.
 *   ort/                              ort.wasm.bundle.min.mjs +
 *                                   ort-wasm-simd-threaded.{mjs,wasm},
 *                                   copied from the browser's vendored
 *                                   /vad dir (same files, same versions).
 *
 * Run standalone (mise run voice:vendor) or imported by build/release.ts;
 * the desktop bundle copies the same output into the app.
 */
import { $ } from "bun";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const OUT = join(ROOT, "build", "vendor", "voice");
const BUILTIN = join(ROOT, "apps", "server", "src", "voice", "builtin");
const VAD = join(ROOT, "apps", "web", "public", "vad");
const SHERPA_WASM = join(
  ROOT,
  "apps",
  "server",
  "node_modules",
  "sherpa-onnx",
  "sherpa-onnx-wasm-nodejs.wasm",
);

export async function buildVoiceVendor(outDir: string = OUT): Promise<string> {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, "ort"), { recursive: true });
  for (const name of ["stt-worker", "tts-worker"]) {
    await $`bun build --target=bun ${join(BUILTIN, `${name}.ts`)} --outfile ${join(outDir, `${name}.js`)}`;
  }
  if (!existsSync(SHERPA_WASM)) {
    throw new Error(`sherpa wasm missing at ${SHERPA_WASM} — run bun install first`);
  }
  cpSync(SHERPA_WASM, join(outDir, "sherpa-onnx-wasm-nodejs.wasm"));
  for (const name of [
    "ort.wasm.bundle.min.mjs",
    "ort-wasm-simd-threaded.mjs",
    "ort-wasm-simd-threaded.wasm",
  ]) {
    cpSync(join(VAD, name), join(outDir, "ort", name));
  }
  return outDir;
}

if (import.meta.main) {
  const dir = await buildVoiceVendor();
  console.log(`voice vendor staged at ${dir}`);
}
