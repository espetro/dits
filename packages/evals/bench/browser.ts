/**
 * Browser voice bench: drives the vite dev app headlessly through the
 * playwright-cli (never raw @playwright/test), imports the stt/tts slice
 * indexes in-page and times the cloud endpoint engines against the mock
 * provider. Optional wasm engines (BENCH_WASM=1) download the models, boot
 * WasmStt/WasmTts and report the window.voiceHealth timings. No thresholds;
 * prints JSON plus a compact table like bench/voice.ts.
 *
 *   bun run packages/evals/bench/browser.ts                 # spawns mock + `portless di-bench`
 *   BENCH_WEB_URL=http://localhost:5173 bun run packages/evals/bench/browser.ts
 *   BENCH_WASM=1 bun run packages/evals/bench/browser.ts    # + on-device engines
 *   BENCH_BASE_URL=... BENCH_API_KEY=... BENCH_*_MODEL=...   # real provider instead of the mock
 */
import { startServer } from "../mock-provider/main.ts";

const env = process.env;
const SESSION = `dibench${process.pid}`;
const PHRASE = env.BENCH_PHRASE ?? "Tell me about a time you debugged a hard production issue.";
const WASM = env.BENCH_WASM === "1";

interface Health {
  kind: string;
  ok: boolean;
  ms?: number;
  detail?: string;
}

interface BrowserBench {
  mode: "cloud";
  stt: { final_ms: number; text: string };
  tts: { total_ms: number; bytes: number };
  llm: { ttft_ms: number; total_ms: number; chars: number };
  wasm: {
    ran: boolean;
    error?: string;
    stt_boot_ms?: number;
    first_partial_ms?: number;
    flush_ms?: number;
    tts_boot_ms?: number;
    tts_speak_ms?: number;
  };
  health: Health[];
}

async function pw(...args: string[]): Promise<string> {
  const p = Bun.spawn(["playwright-cli", `-s=${SESSION}`, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: env.TMPDIR ?? "/tmp",
  });
  const out = await new Response(p.stdout).text();
  await p.exited;
  return out;
}

/** run an async arrow in the page, return its JSON result */
async function evalJson<T>(fn: string): Promise<T> {
  const out = await pw("eval", fn);
  const m = out.match(/### Result\n([\s\S]*?)\n### /);
  if (!m) throw new Error(`playwright-cli eval failed: ${out.slice(0, 400)}`);
  const parsed: unknown = JSON.parse(m[1]!);
  return (typeof parsed === "string" ? JSON.parse(parsed) : parsed) as T;
}

async function webUrl(): Promise<{ url: string; stop: () => void }> {
  if (env.BENCH_WEB_URL) return { url: env.BENCH_WEB_URL.replace(/\/+$/, ""), stop: () => {} };
  const dir = new URL("../../../apps/web/", import.meta.url).pathname;
  const proc = Bun.spawn(["portless", "di-bench", "bun", "run", "dev"], {
    cwd: dir,
    stdout: "ignore",
    stderr: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    await Bun.sleep(500);
    const q = Bun.spawnSync(["portless", "get", "di-bench"]);
    const url = q.stdout.toString().trim();
    if (url) {
      const ok = await fetch(url, { tls: { rejectUnauthorized: false } }).then(
        (r) => r.ok,
        () => false,
      );
      if (ok) return { url: url.replace(/\/+$/, ""), stop: () => proc.kill() };
    }
  }
  proc.kill();
  throw new Error("vite dev did not come up via portless");
}

/** in-page bench body; config is inlined as JSON */
function pageFn(cfg: object): string {
  return `async () => {
  const cfg = ${JSON.stringify(cfg)};
  const { EndpointStt, WasmStt, createEndpointStt } = await import('/src/lib/stt/index.ts');
  const { synthesizeSpeech, WasmTts } = await import('/src/lib/tts/index.ts');
  const hdr = cfg.apiKey ? { authorization: 'Bearer ' + cfg.apiKey } : {};
  const out = { mode: 'cloud', wasm: { ran: false } };
  // stt: 1s tone, 100ms frames, one flush
  const frames = [];
  for (let f = 0; f < 10; f++) {
    const fr = new Float32Array(1600);
    for (let i = 0; i < 1600; i++) fr[i] = 0.5 * Math.sin((2 * Math.PI * 220 * (f * 1600 + i)) / 16000);
    frames.push(fr);
  }
  const stt = createEndpointStt({ baseUrl: cfg.base, model: cfg.sttModel, apiKey: cfg.apiKey || '' });
  let text = '';
  await stt.start({ onFinal: (t) => { text = t; }, onInterim() {}, onSpeechStart() {} });
  frames.forEach((fr) => stt.feed(fr));
  let t0 = performance.now();
  await stt.flush();
  out.stt = { final_ms: Math.round(performance.now() - t0), text };
  await stt.stop();
  // tts: full synth (the endpoint adapter buffers the wav)
  t0 = performance.now();
  const pcm = await synthesizeSpeech({ baseUrl: cfg.base, model: cfg.ttsModel, apiKey: cfg.apiKey || '', voice: 'alloy' }, cfg.phrase);
  out.tts = { total_ms: Math.round(performance.now() - t0), bytes: pcm.byteLength };
  // llm: sse ttft (same shape as bench/voice.ts)
  t0 = performance.now();
  const res = await fetch(cfg.base.replace(/\\/+$/, '') + '/chat/completions', {
    method: 'POST', headers: { ...hdr, 'content-type': 'application/json' },
    body: JSON.stringify({ model: cfg.llmModel, stream: true, max_tokens: 64, messages: [{ role: 'user', content: cfg.phrase }] }),
  });
  const rd = res.body.getReader(); const dec = new TextDecoder();
  let buf = '', chars = 0, ttft = 0;
  for (;;) {
    const { done, value } = await rd.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\\n'); buf = lines.pop() || '';
    for (const l of lines) {
      if (!l.startsWith('data:') || l.includes('[DONE]')) continue;
      try { const d = JSON.parse(l.slice(5)).choices?.[0]?.delta?.content; if (d) { if (!ttft) ttft = performance.now() - t0; chars += d.length; } } catch {}
    }
  }
  out.llm = { ttft_ms: Math.round(ttft), total_ms: Math.round(performance.now() - t0), chars };
  if (cfg.wasm) {
    out.wasm.ran = true;
    try {
      const models = await import('/src/lib/voice/models.ts');
      const { $voiceModelsConsent } = await import('/src/stores/voice.ts');
      $voiceModelsConsent.set('granted');
      await models.downloadVoiceModels();
      const errs = [];
      try {
        const ws = new WasmStt();
        await ws.start({ onFinal() {}, onInterim() {}, onSpeechStart() {} });
        frames.forEach((fr) => ws.feed(fr));
        await ws.flush();
        await ws.stop();
      } catch (e) { errs.push('stt: ' + (e && e.message || e)); }
      try {
        const wt = new WasmTts();
        for await (const _c of wt.speak(cfg.phrase)) { /* drain */ }
        wt.dispose();
      } catch (e) { errs.push('tts: ' + (e && e.message || e)); }
      if (errs.length) out.wasm.error = errs.join(' | ');
    } catch (e) { out.wasm.error = String(e && e.message || e); }
  }
  out.health = (window.voiceHealth || []).map((h) => ({ kind: h.kind, ok: h.ok, ms: h.ms, detail: h.detail }));
  return JSON.stringify(out);
}`;
}

async function main(): Promise<void> {
  const mock = env.BENCH_BASE_URL ? null : startServer(0);
  const base = env.BENCH_BASE_URL ?? `http://localhost:${mock!.port}/v1`;
  const web = await webUrl();
  try {
    await pw("open", `${web.url}/dev/voice-harness`);
    // dev-only window.voiceHealth is populated after the module graph loads
    const r = await evalJson<BrowserBench & { wasm: Record<string, unknown> }>(
      pageFn({
        base,
        apiKey: env.BENCH_API_KEY ?? "",
        llmModel: env.BENCH_LLM_MODEL ?? "mock-llm",
        sttModel: env.BENCH_STT_MODEL ?? "mock-stt",
        ttsModel: env.BENCH_TTS_MODEL ?? "mock-tts",
        phrase: PHRASE,
        wasm: WASM,
      }),
    );
    const health = r.health ?? [];
    const ms = (kind: string, detail?: string) =>
      health.find((h) => h.ok && h.kind === kind && (!detail || h.detail === detail))?.ms;
    r.wasm = {
      ...r.wasm,
      stt_boot_ms: ms("engine.boot", "stt"),
      first_partial_ms: ms("stt.firstPartial"),
      flush_ms: ms("stt.flush"),
      tts_boot_ms: ms("engine.boot", "tts"),
      tts_speak_ms: ms("tts.speak"),
    };
    console.log(JSON.stringify(r));
    console.table({
      stt: { ms: r.stt.final_ms },
      tts: { ms: r.tts.total_ms, bytes: r.tts.bytes },
      llm: { ms: r.llm.ttft_ms, total_ms: r.llm.total_ms },
      ...(WASM
        ? {
            wasm_stt: { ms: r.wasm.first_partial_ms ?? null, boot_ms: r.wasm.stt_boot_ms ?? null },
            wasm_tts: { ms: r.wasm.tts_speak_ms ?? null, boot_ms: r.wasm.tts_boot_ms ?? null },
          }
        : {}),
    });
    if (r.wasm.error) console.error(`wasm: ${r.wasm.error}`);
  } finally {
    await pw("close");
    web.stop();
    mock?.stop(true);
  }
}

await main();
