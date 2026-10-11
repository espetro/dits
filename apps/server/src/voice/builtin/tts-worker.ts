/**
 * Server-side KittenTTS worker entry: identical surface to the browser
 * kitten worker — createKittenApi resolves ort from `wasmBase`, which on
 * the server is a filesystem dir (vendor/voice/ort/ in releases, the
 * vendored apps/web/public/vad/ in dev) holding ort.wasm.bundle.min.mjs +
 * ort-wasm-simd-threaded.{mjs,wasm}.
 */
import { expose } from "kkrpc/streaming";
import { workerSelfTransport } from "kkrpc/worker";
import { createKittenApi } from "@di/voice-engines/kitten";

expose(createKittenApi(), workerSelfTransport());
