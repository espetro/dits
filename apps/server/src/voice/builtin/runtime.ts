/**
 * Locate the builtin voice runtime. Two layouts:
 *
 * - vendored (release tarball / desktop bundle): pre-built worker bundles +
 *   the wasm blobs in a vendor/voice dir beside the executable — Bun cannot
 *   embed Workers in `bun build --compile`, so workers are spawned by
 *   absolute path.
 * - dev (bun run on the source tree): the TS worker sources in this dir run
 *   directly (Bun compiles them at spawn); ort assets resolve from the
 *   vendored apps/web/public/vad dir.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface VoiceRuntime {
  sttWorker: string;
  ttsWorker: string;
  /** dir holding ort.wasm.bundle.min.mjs + ort-wasm-simd-threaded.* (no trailing slash needed) */
  ortDir: string;
}

export function resolveVoiceRuntime(): VoiceRuntime | null {
  for (const dir of vendorCandidates()) {
    if (existsSync(join(dir, "stt-worker.js")) && existsSync(join(dir, "tts-worker.js"))) {
      return {
        sttWorker: join(dir, "stt-worker.js"),
        ttsWorker: join(dir, "tts-worker.js"),
        ortDir: join(dir, "ort"),
      };
    }
  }
  const src = import.meta.dir;
  const ortDir = resolve(src, "../../../../../apps/web/public/vad");
  if (
    existsSync(join(src, "stt-worker.ts")) &&
    existsSync(join(ortDir, "ort.wasm.bundle.min.mjs"))
  ) {
    return {
      sttWorker: join(src, "stt-worker.ts"),
      ttsWorker: join(src, "tts-worker.ts"),
      ortDir,
    };
  }
  return null;
}

function vendorCandidates(): string[] {
  return [
    // compiled release tarball: vendor/voice beside the `di` binary
    join(dirname(process.execPath), "vendor", "voice"),
    // electrobun bundle: vendor/voice next to the bundled bun entrypoint
    resolve(import.meta.dir, "../vendor/voice"),
    // repo build output when the server runs from a checkout root
    resolve(process.cwd(), "build", "vendor", "voice"),
  ];
}
