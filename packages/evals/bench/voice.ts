/**
 * Voice pipeline bench: times stt, tts, llm and a chained turn against any
 * OpenAI-compatible base url. No thresholds; prints JSON plus a compact table.
 *
 *   bun run packages/evals/bench/voice.ts                 # spawns the mock provider
 *   BENCH_BASE_URL=http://localhost:8317/v1 BENCH_API_KEY=... \
 *   BENCH_LLM_MODEL=x BENCH_STT_MODEL=y BENCH_TTS_MODEL=z BENCH_REF="expected transcript" \
 *     bun run packages/evals/bench/voice.ts
 */
import { makeWav, startServer } from "../mock-provider/main.ts";

interface BenchResult {
  stt: { final_ms: number; rtf: number; wer: number | null; text: string };
  tts: { first_chunk_ms: number; total_ms: number; rtf: number; bytes: number };
  llm: { ttft_ms: number; total_ms: number; tokens_per_s: number; chars: number };
  chain: { stt_ms: number; llm_ttft_ms: number; tts_first_chunk_ms: number; total_ms: number };
}

const env = process.env;
const PHRASE = env.BENCH_PHRASE ?? "Tell me about a time you debugged a hard production issue.";

function endpoint(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}

function wavSeconds(wav: Uint8Array): number {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const byteRate = view.getUint32(28, true);
  return byteRate > 0 ? (wav.byteLength - 44) / byteRate : 0;
}

/** word error rate via word-level levenshtein; null without a reference */
function wer(ref: string, hyp: string): number | null {
  const norm = (s: string) => s.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  const r = norm(ref);
  const h = norm(hyp);
  if (r.length === 0) return null;
  let prev = Array.from({ length: h.length + 1 }, (_, i) => i);
  for (let i = 1; i <= r.length; i++) {
    const cur = [i];
    for (let j = 1; j <= h.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (r[i - 1] === h[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[h.length]! / r.length;
}

async function readFirstChunk(res: Response): Promise<{ first: number; bytes: number }> {
  const reader = res.body!.getReader();
  const t0 = performance.now();
  let first = -1;
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (first < 0 && value.byteLength > 0) first = performance.now() - t0;
    bytes += value.byteLength;
  }
  return { first: first < 0 ? 0 : first, bytes };
}

async function main(): Promise<void> {
  const mock = env.BENCH_BASE_URL ? null : startServer(0);
  const base = env.BENCH_BASE_URL ?? `http://localhost:${mock!.port}/v1`;
  const headers: Record<string, string> = env.BENCH_API_KEY
    ? { authorization: `Bearer ${env.BENCH_API_KEY}` }
    : {};
  const models = {
    llm: env.BENCH_LLM_MODEL ?? "mock-llm",
    stt: env.BENCH_STT_MODEL ?? "mock-stt",
    tts: env.BENCH_TTS_MODEL ?? "mock-tts",
  };

  async function stt(wav: Uint8Array): Promise<{ ms: number; text: string }> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "audio.wav");
    form.append("model", models.stt);
    const t0 = performance.now();
    const res = await fetch(endpoint(base, "/audio/transcriptions"), {
      method: "POST",
      headers,
      body: form,
    });
    if (!res.ok) throw new Error(`stt http ${res.status}`);
    const json = (await res.json()) as { text: string };
    return { ms: performance.now() - t0, text: json.text };
  }

  async function tts(text: string): Promise<{ first: number; total: number; bytes: number }> {
    const t0 = performance.now();
    const res = await fetch(endpoint(base, "/audio/speech"), {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        input: text,
        model: models.tts,
        voice: env.BENCH_TTS_VOICE ?? "alloy",
        response_format: "wav",
      }),
    });
    if (!res.ok) throw new Error(`tts http ${res.status}`);
    const { first, bytes } = await readFirstChunk(res);
    return { first, total: performance.now() - t0, bytes };
  }

  async function llm(
    prompt: string,
  ): Promise<{ ttft: number; total: number; chars: number; text: string }> {
    const t0 = performance.now();
    const res = await fetch(endpoint(base, "/chat/completions"), {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        model: models.llm,
        stream: true,
        max_tokens: 64,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`llm http ${res.status}`);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let text = "";
    let ttft = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:") || line.includes("[DONE]")) continue;
        try {
          const delta = JSON.parse(line.slice(5)).choices?.[0]?.delta?.content as
            | string
            | undefined;
          if (delta) {
            if (!ttft) ttft = performance.now() - t0;
            text += delta;
          }
        } catch {
          // keepalive / partial frame
        }
      }
    }
    return { ttft, total: performance.now() - t0, chars: text.length, text };
  }

  // fixture audio: the mock returns a 1s tone; real providers get BENCH_WAV
  const wav = env.BENCH_WAV
    ? new Uint8Array(await Bun.file(env.BENCH_WAV).arrayBuffer())
    : makeWav();
  const audioSec = wavSeconds(wav);

  const s = await stt(wav);
  const t = await tts(PHRASE);
  const l = await llm(PHRASE);
  const ttsAudioSec = t.bytes > 44 ? (t.bytes - 44) / (24_000 * 2) : 0;

  const c0 = performance.now();
  const cs = await stt(wav);
  const cl = await llm(cs.text || PHRASE);
  const ct = await tts(cl.text.split(/(?<=[.!?])\s/)[0] || PHRASE);
  const chainTotal = performance.now() - c0;

  const result: BenchResult = {
    stt: {
      final_ms: Math.round(s.ms),
      rtf: audioSec ? +(s.ms / 1000 / audioSec).toFixed(3) : 0,
      wer: env.BENCH_REF ? wer(env.BENCH_REF, s.text) : null,
      text: s.text,
    },
    tts: {
      first_chunk_ms: Math.round(t.first),
      total_ms: Math.round(t.total),
      rtf: ttsAudioSec ? +(t.total / 1000 / ttsAudioSec).toFixed(3) : 0,
      bytes: t.bytes,
    },
    llm: {
      ttft_ms: Math.round(l.ttft),
      total_ms: Math.round(l.total),
      tokens_per_s: l.total > l.ttft ? +(l.chars / 4 / ((l.total - l.ttft) / 1000)).toFixed(1) : 0,
      chars: l.chars,
    },
    chain: {
      stt_ms: Math.round(cs.ms),
      llm_ttft_ms: Math.round(cl.ttft),
      tts_first_chunk_ms: Math.round(ct.first),
      total_ms: Math.round(chainTotal),
    },
  };
  console.log(JSON.stringify(result));
  console.table({
    stt: { ms: result.stt.final_ms, rtf: result.stt.rtf, wer: result.stt.wer },
    tts: { ms: result.tts.first_chunk_ms, rtf: result.tts.rtf },
    llm: { ms: result.llm.ttft_ms, tok_s: result.llm.tokens_per_s },
    chain: { ms: result.chain.total_ms },
  });
  mock?.stop(true);
}

await main();
