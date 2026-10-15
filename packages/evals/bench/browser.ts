/**
 * Browser voice bench: drives the vite dev app headlessly through the
 * playwright-cli (never raw @playwright/test), imports the stt/tts slice
 * indexes in-page and times the cloud endpoint engines against the mock
 * provider, and drives the real ClientAgent turn (llm.turn health event).
 * Optional wasm engines (BENCH_WASM=1) download the models, boot WasmStt and
 * WasmTts, round trip the TTS output back through STT (WER vs the phrase) and
 * report the window.voiceHealth timings. vite dev serves the sherpa stt worker
 * as an ES module (it must be classic), so with BENCH_WASM=1 the web app is
 * built, dist/client is served statically, the built classic worker runs from
 * there and VITE_SHERPA_ASSETS_BASE points the dev page at its assets.
 * No thresholds; prints JSON plus a compact table like bench/voice.ts.
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
  agent: {
    llm_turn_ms?: number;
    ttft_ms?: number;
    total_ms: number;
    chars: number;
    error?: string;
  };
  wasm: {
    ran: boolean;
    error?: string;
    stt_boot_ms?: number;
    first_partial_ms?: number;
    flush_ms?: number;
    roundtrip_text?: string;
    roundtrip_wer?: number;
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

const WEB_DIR = new URL("../../../apps/web/", import.meta.url).pathname;

interface Prod {
  base: string;
  workerUrl: string;
  stop: () => void;
}

/** build apps/web and serve dist/client (cors open: the dev page loads assets cross-origin) */
async function serveProd(): Promise<Prod> {
  const build =
    env.BENCH_NO_BUILD === "1"
      ? { exitCode: 0, stderr: "" }
      : Bun.spawnSync(["bun", "run", "build"], { cwd: WEB_DIR, stdout: "ignore", stderr: "pipe" });
  if (build.exitCode !== 0)
    throw new Error(`web build failed: ${String(build.stderr).slice(-400)}`);
  const root = `${WEB_DIR}dist/client`;
  const worker = [...new Bun.Glob("assets/stt-worker-*.js").scanSync(root)][0];
  if (!worker) throw new Error("built stt worker not found in dist/client/assets");
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = decodeURIComponent(new URL(req.url).pathname);
      const file = Bun.file(`${root}${path}`);
      if (path.includes("..") || !(await file.exists())) return new Response("nf", { status: 404 });
      return new Response(file, { headers: { "access-control-allow-origin": "*" } });
    },
  });
  const base = `http://localhost:${server.port}`;
  return { base, workerUrl: `${base}/${worker}`, stop: () => void server.stop(true) };
}

async function webUrl(prod: Prod | null): Promise<{ url: string; stop: () => void }> {
  if (env.BENCH_WEB_URL) return { url: env.BENCH_WEB_URL.replace(/\/+$/, ""), stop: () => {} };
  const proc = Bun.spawn(["portless", "di-bench", "bun", "run", "dev"], {
    cwd: WEB_DIR,
    stdout: "ignore",
    stderr: "ignore",
    env: prod ? { ...env, VITE_SHERPA_ASSETS_BASE: `${prod.base}/sherpa` } : env,
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
  // real llm path: ClientAgent (openai-compatible model + streamText) -> llm.turn health event
  try {
    const { ClientAgent } = await import('/src/lib/agent/client-agent.ts');
    const agent = await ClientAgent.create(
      { mode: 'remote', baseUrl: cfg.base, apiKey: cfg.apiKey || '', model: cfg.llmModel },
      { update_question: async () => 'ok', read_editor: async () => '', read_whiteboard: async () => '' },
      () => ({ mode: 'interview' }),
    );
    let m = null, chars2 = 0, errMsg;
    t0 = performance.now();
    await agent.respond(cfg.phrase, { onText: (d) => { chars2 += d.length; }, onMetrics: (x) => { m = x; }, onError: (e) => { errMsg = String(e && e.message || e); } });
    out.agent = { ttft_ms: m && m.llm_ttft_ms, total_ms: Math.round(performance.now() - t0), chars: chars2, error: errMsg };
  } catch (e) { out.agent = { total_ms: 0, chars: 0, error: String(e && e.message || e) }; }
  if (cfg.wasm) {
    out.wasm.ran = true;
    try {
      const models = await import('/src/lib/voice/models.ts');
      const { $voiceModelsConsent } = await import('/src/stores/voice.ts');
      $voiceModelsConsent.set('granted');
      await models.downloadVoiceModels();
      const errs = [];
      // classic worker from the production build (dev serves it as an ES module)
      const workerFactory = () => new Worker(URL.createObjectURL(new Blob(['importScripts(' + JSON.stringify(cfg.workerUrl) + ')'])));
      let tts16 = null;
      try {
        const wt = new WasmTts();
        const chunks = [];
        for await (const c of wt.speak(cfg.phrase)) chunks.push(c);
        wt.dispose();
        const n = chunks.reduce((a, c) => a + c.length, 0);
        const all = new Float32Array(n);
        let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
        const ratio = 24000 / 16000, len = Math.floor(n / ratio);
        tts16 = new Float32Array(len);
        for (let i = 0; i < len; i++) {
          const x = i * ratio, i0 = Math.floor(x), f = x - i0;
          tts16[i] = all[i0] * (1 - f) + (all[Math.min(i0 + 1, n - 1)] * f);
        }
      } catch (e) { errs.push('tts: ' + (e && e.message || e)); }
      try {
        const ws = new WasmStt({ workerFactory });
        let final = '';
        await ws.start({ onFinal: (t) => { final += (final ? ' ' : '') + t; }, onInterim() {}, onSpeechStart() {} });
        // speech sample: the wasm tts output (tone fallback if tts failed), 100ms frames + 0.5s silence tail
        const src = tts16 || frames.reduce((a, f) => { const r = new Float32Array(a.length + f.length); r.set(a); r.set(f, a.length); return r; }, new Float32Array(0));
        for (let i = 0; i < src.length; i += 1600) ws.feed(src.subarray(i, Math.min(i + 1600, src.length)));
        for (let i = 0; i < 5; i++) ws.feed(new Float32Array(1600));
        const tf = performance.now();
        await ws.flush();
        out.wasm.flush_ms = Math.round(performance.now() - tf);
        await ws.stop();
        out.wasm.roundtrip_text = final;
        const norm = (s) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\\s+/).filter(Boolean);
        const r = norm(cfg.phrase), h = norm(final);
        const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
        for (let j = 1; j <= h.length; j++) d[0][j] = j;
        for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++)
          d[i][j] = Math.min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + (r[i-1] === h[j-1] ? 0 : 1));
        out.wasm.roundtrip_wer = +(d[r.length][h.length] / r.length).toFixed(3);
      } catch (e) { errs.push('stt: ' + (e && e.message || e)); }
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
  const prod = WASM ? await serveProd() : null;
  const web = await webUrl(prod);
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
        workerUrl: prod?.workerUrl ?? "",
      }),
    );
    const health = r.health ?? [];
    const ms = (kind: string, detail?: string) =>
      health.find((h) => h.ok && h.kind === kind && (!detail || h.detail === detail))?.ms;
    r.wasm = {
      ...r.wasm,
      stt_boot_ms: ms("engine.boot", "stt"),
      first_partial_ms: ms("stt.firstPartial"),
      flush_ms: r.wasm.flush_ms ?? ms("stt.flush"),
      tts_boot_ms: ms("engine.boot", "tts"),
      tts_speak_ms: ms("tts.speak"),
    };
    r.agent.llm_turn_ms = ms("llm.turn");
    console.log(JSON.stringify(r));
    console.table({
      stt: { ms: r.stt.final_ms },
      tts: { ms: r.tts.total_ms, bytes: r.tts.bytes },
      llm: { ms: r.llm.ttft_ms, total_ms: r.llm.total_ms },
      llm_turn: { ms: r.agent.llm_turn_ms ?? null, total_ms: r.agent.total_ms },
      ...(WASM
        ? {
            wasm_stt: {
              ms: r.wasm.first_partial_ms ?? null,
              boot_ms: r.wasm.stt_boot_ms ?? null,
              flush_ms: r.wasm.flush_ms ?? null,
              wer: r.wasm.roundtrip_wer ?? null,
            },
            wasm_tts: { ms: r.wasm.tts_speak_ms ?? null, boot_ms: r.wasm.tts_boot_ms ?? null },
          }
        : {}),
    });
    if (r.wasm.error) console.error(`wasm: ${r.wasm.error}`);
    if (r.agent.error) console.error(`agent: ${r.agent.error}`);
  } finally {
    await pw("close");
    web.stop();
    prod?.stop();
    mock?.stop(true);
  }
}

await main();
