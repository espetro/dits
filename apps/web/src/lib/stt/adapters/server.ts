import { DiError } from "../../errors";
import { API_BASE } from "../../runtime";

/**
 * Server-layer stt test: posts a captured 16k mono pcm16 wav to the di
 * server, which transcribes it through its configured adapter (builtin
 * sherpa or remote whisper) and returns the text plus server-measured time.
 */
export async function testServerStt(wav: Uint8Array): Promise<{ text: string; ms: number }> {
  const t0 = performance.now();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/v1/voice/stt-test`, {
      method: "POST",
      headers: { "content-type": "audio/wav" },
      body: wav as unknown as BodyInit,
    });
  } catch (err) {
    throw new DiError(
      "stt.server",
      { status: 0, detail: err instanceof Error ? err.message : "network" },
      err instanceof Error ? err.message : undefined,
    );
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
    if (body?.code === "stt_model_missing") throw new DiError("stt.serverModelMissing");
    throw new DiError(
      "stt.server",
      { status: res.status, detail: body?.error ?? `HTTP ${res.status}` },
      body?.error,
    );
  }
  const json = (await res.json()) as { text?: string; ms?: number };
  return {
    text: json.text ?? "",
    ms: Number(json.ms) || Math.round(performance.now() - t0),
  };
}
