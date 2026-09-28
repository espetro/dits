/// <reference lib="webworker" />
/**
 * KittenTTS worker entry: exposes createKittenApi over kkrpc. All inference
 * logic lives in ./kitten-api so it stays importable (and testable) off the
 * worker thread.
 */
import { expose } from "kkrpc/streaming";
import { workerSelfTransport } from "kkrpc/worker";

import { createKittenApi } from "./kitten-api";

expose(createKittenApi(), workerSelfTransport());
