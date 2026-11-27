import { encodeWav } from "../voice/wav";
import { startCapture } from "../voice/capture";
import { testServerStt } from "./adapters/server";

/**
 * Server-layer stt test: record the selected mic for the window, then post
 * the sample to the di server and report what its configured stt heard.
 * `stop()` aborts and discards; the window elapsing submits.
 */
export async function startServerSttTest(opts: {
  deviceId?: string;
  windowMs?: number;
  onResult: (r: { text: string; ms: number }) => void;
  onError: (err: unknown) => void;
}): Promise<{ stop: () => Promise<void> }> {
  const audio: MediaTrackConstraints | boolean = opts.deviceId
    ? { deviceId: { ideal: opts.deviceId } }
    : true;
  const capture = await startCapture({
    getUserMedia: (c) => navigator.mediaDevices.getUserMedia({ ...(c as object), audio }),
  });
  const frames: Float32Array[] = [];
  capture.onFloat32Frame?.((samples) => frames.push(samples));
  let done = false;
  async function finish(submit: boolean): Promise<void> {
    if (done) return;
    done = true;
    clearTimeout(timer);
    await capture.stop().catch(() => undefined);
    if (!submit) return;
    try {
      opts.onResult(await testServerStt(encodeWav(frames)));
    } catch (err) {
      opts.onError(err);
    }
  }
  const timer = setTimeout(() => void finish(true), opts.windowMs ?? 6_000);
  return { stop: () => finish(false) };
}
