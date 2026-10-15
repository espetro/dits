import { DiError } from "../../errors";
import { API_BASE } from "../../runtime";

/**
 * Server-layer tts test: the di server synthesizes through its configured
 * adapter (builtin kitten or remote endpoint) and returns a wav plus the
 * server-measured synth time.
 */
export async function testServerTts(text: string): Promise<{ clip: Blob; ms: number }> {
  const t0 = performance.now();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/v1/voice/tts-test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    throw new DiError("tts.server", { status: 0 }, err instanceof Error ? err.message : undefined);
  }
  if (!res.ok) {
    const detail = ((await res.json().catch(() => null)) as { error?: string } | null)?.error;
    throw new DiError("tts.server", { status: res.status }, detail);
  }
  const clip = await res.blob();
  const ms = Number(res.headers.get("x-synth-ms")) || Math.round(performance.now() - t0);
  return { clip, ms };
}
