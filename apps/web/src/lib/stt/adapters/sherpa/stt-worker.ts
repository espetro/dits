/// <reference lib="webworker" />
/**
 * sherpa stt worker entry: exposes createSherpaSttApi over kkrpc. The worker
 * must stay CLASSIC (`type: "classic"` at the spawn site) because the sherpa
 * glue + asr scripts attach `Module`/`createOnlineRecognizer` via top-level
 * vars — they can only come in through importScripts, which module workers
 * do not have. Static imports of kkrpc/stt-api are fine: vite bundles them
 * into the worker's iife chunk.
 */
import { expose } from "kkrpc/streaming";
import { workerSelfTransport } from "kkrpc/worker";

import { createSherpaSttApi } from "./stt-api";

expose(
  createSherpaSttApi({ loadScripts: (urls) => self.importScripts(...urls) }),
  workerSelfTransport(),
);
