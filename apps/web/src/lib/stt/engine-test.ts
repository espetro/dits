import { startCapture } from "../voice/capture";
import type { SttEngine } from "./port";

/**
 * Engine stt test (wasm/cloud): capture mic audio for the window, feed the
 * picked engine, then flush once — whatever was recognized lands in onText.
 * The selected mic is honored through the getUserMedia constraint.
 */
export async function startEngineSttTest(opts: {
  create(): Promise<SttEngine> | SttEngine;
  deviceId?: string;
  onText: (text: string) => void;
  onError: (message: string) => void;
  timeoutMs?: number;
}): Promise<{ stop: () => Promise<void> }> {
  const engine = await opts.create();
  const audio: MediaTrackConstraints | boolean = opts.deviceId
    ? { deviceId: { ideal: opts.deviceId } }
    : true;
  const capture = await startCapture({
    getUserMedia: (c) => navigator.mediaDevices.getUserMedia({ ...(c as object), audio }),
  });
  const out: string[] = [];
  let stopped = false;
  const timer = setTimeout(() => void stop(), opts.timeoutMs ?? 12_000);
  await engine.start({
    onFinal: (t) => {
      out.push(t);
      opts.onText(out.join(" "));
    },
    onInterim: () => undefined,
    onSpeechStart: () => undefined,
  });
  capture.onFloat32Frame?.((samples) => engine.feed(samples));
  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    try {
      await engine.flush();
    } catch (err) {
      opts.onError(err instanceof Error ? err.message : String(err));
    }
    await capture.stop().catch(() => undefined);
    await engine.stop().catch(() => undefined);
  }
  return { stop };
}
