import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface MockFixture {
  chat: { content: string }[];
  transcription: string;
  models: string[];
  /** Canned report body returned for report prompts (sentinel: "overall_score"). */
  report?: Record<string, unknown>;
}

export function loadFixture(name = "default"): MockFixture {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");
  return JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8")) as MockFixture;
}

/** Minimal valid 16-bit PCM mono WAV, 1 second at 8kHz. */
export function makeWav(): Uint8Array {
  const sampleRate = 8000;
  const numSamples = sampleRate;
  const dataSize = numSamples * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < numSamples; i++) {
    view.setInt16(
      44 + i * 2,
      Math.round(Math.sin((i / sampleRate) * 440 * 2 * Math.PI) * 32000),
      true,
    );
  }
  return new Uint8Array(buf);
}

type Handler = (
  req: Request,
  fixture: MockFixture,
  state: MockServerState,
) => Response | Promise<Response>;

/** Test-tooling state: last request headers per path + live chat stream count. */
export type FailMode =
  /** chat and models answer HTTP 401 with an openai-style json error */
  | "401"
  /** GET /models and /v1/models answer 200 text/html (a login or landing page) */
  | "html-models"
  /** only GET /models (no version path) answers html: /v1/models stays valid, so a root base url gets a suggestion */
  | "html-root"
  /** streamed chat answers 200 with an in-band sse error chunk */
  | "sse-error"
  /** GET /v1/models answers 200 with a valid but empty list */
  | "empty-models"
  /** streamed chat thinks for a while: reasoning deltas after a delay, then the answer */
  | "slow-reasoning";

export const FAIL_MODES: readonly FailMode[] = [
  "401",
  "html-models",
  "html-root",
  "sse-error",
  "empty-models",
  "slow-reasoning",
];

/** first-token delay of slow-reasoning mode; long enough to show a pending state */
export const SLOW_REASONING_DELAY_MS = 4_000;

export interface MockServerState {
  /** active failure injection; set via POST /__fail {mode} or --fail. null = healthy. */
  fail: FailMode | null;
  /** lowercased header snapshot of the most recent request per path */
  lastHeaders: Map<string, Record<string, string>>;
  /** in-flight POST /v1/chat/completions requests (streams not yet closed) */
  inflight: number;
}

const HTML_PAGE = "<!doctype html><html><body><h1>Sign in</h1></body></html>";

function htmlPage(): Response {
  return new Response(HTML_PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
}

function recordHeaders(state: MockServerState, req: Request): void {
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  state.lastHeaders.set(new URL(req.url).pathname, headers);
}

/** Snapshot helper for /__state responses. */
export function stateSnapshot(state: MockServerState): {
  lastHeaders: Record<string, Record<string, string>>;
  inflight: number;
} {
  return {
    lastHeaders: Object.fromEntries(state.lastHeaders),
    inflight: state.inflight,
  };
}

/** Deterministic embedding: 64-dim token-hash bag-of-words, L2-normalized. */
export function mockEmbed(text: string, dims = 64): number[] {
  const vec = new Array<number>(dims).fill(0);
  for (const token of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    let h = 2166136261;
    for (let i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    vec[Math.abs(h) % dims]! += 1;
  }
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? vec : vec.map((x) => x / norm);
}

const routes: [string, string, Handler][] = [
  [
    "POST",
    "/v1/embeddings",
    async (req) => {
      const body = (await req.json()) as { input: string | string[] };
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      return Response.json({
        object: "list",
        model: "mock-embed",
        data: inputs.map((text, index) => ({
          object: "embedding",
          index,
          embedding: mockEmbed(text),
        })),
        usage: { prompt_tokens: 0, total_tokens: 0 },
      });
    },
  ],
  [
    "POST",
    "/v1/chat/completions",
    async (req, fx, state) => {
      if (state.fail === "401") {
        return Response.json(
          { error: { message: "invalid api key (mock 401)", type: "invalid_request_error" } },
          { status: 401 },
        );
      }
      state.inflight++;
      const body = (await req.json().catch(() => ({}))) as {
        stream?: boolean;
        messages?: { content?: string }[];
      };
      const created = Math.floor(Date.now() / 1000);
      // Report prompts carry the `overall_score` rubric and a `session_id:`
      // line (see buildReportPrompt); echo the fixture report so the e2e
      // full-loop spec exercises the real generator path.
      const promptText = (body.messages ?? []).map((m) => m.content ?? "").join("\n");
      let content = fx.chat[0]!.content;
      if (promptText.includes("overall_score") && fx.report) {
        const sessionId =
          /session_id:\s*([0-9a-f-]{36})/i.exec(promptText)?.[1] ?? crypto.randomUUID();
        content = JSON.stringify({
          ...fx.report,
          session_id: sessionId,
          generated_at: new Date().toISOString(),
        });
      }
      if (!body.stream) {
        state.inflight--;
        return Response.json({
          id: "chatcmpl-mock",
          object: "chat.completion",
          created,
          model: "mock-llm",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });
      }
      // real sse: the browser llm client always requests stream:true, so
      // evals/e2e exercise the same parse path as a live provider. inflight
      // drains when the stream finishes, errors or the client cancels.
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        cancel() {
          state.inflight--;
        },
        async start(controller) {
          const send = (obj: unknown) =>
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
          const base = {
            id: "chatcmpl-mock",
            object: "chat.completion.chunk",
            created,
            model: "mock-llm",
          };
          if (state.fail === "sse-error") {
            send({ error: { message: "upstream exploded (mock in-band error)" } });
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            state.inflight--;
            return;
          }
          if (state.fail === "slow-reasoning") {
            await new Promise((resolve) => setTimeout(resolve, SLOW_REASONING_DELAY_MS));
            for (let i = 0; i < 20; i++) {
              send({
                ...base,
                choices: [
                  {
                    index: 0,
                    delta: { reasoning_content: `thinking step ${i} ` },
                    finish_reason: null,
                  },
                ],
              });
            }
          }
          send({
            ...base,
            choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
          });
          for (const piece of content.match(/\S+\s*/g) ?? []) {
            send({
              ...base,
              choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
            });
          }
          send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          state.inflight--;
        },
      });
      return new Response(stream, {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      });
    },
  ],
  [
    "POST",
    "/v1/audio/transcriptions",
    (_req, fx) => {
      return Response.json({
        text: fx.transcription,
      });
    },
  ],
  [
    "POST",
    "/v1/audio/speech",
    () => {
      return new Response(makeWav(), {
        headers: { "content-type": "audio/wav" },
      });
    },
  ],
  [
    "GET",
    "/v1/models",
    (_req, fx, state) => {
      if (state.fail === "401") {
        return Response.json({ error: { message: "invalid api key (mock 401)" } }, { status: 401 });
      }
      if (state.fail === "html-models") return htmlPage();
      return Response.json({
        object: "list",
        data: (state.fail === "empty-models" ? [] : fx.models).map((id) => ({
          id,
          object: "model",
          owned_by: "mock",
        })),
      });
    },
  ],
  [
    "GET",
    "/models",
    (_req, _fx, state) =>
      state.fail === "html-models" || state.fail === "html-root"
        ? htmlPage()
        : Response.json({ error: { message: "no route: GET /models" } }, { status: 404 }),
  ],
  ["GET", "/health", () => Response.json({ ok: true })],
  // test tooling: e2e specs assert on the recorded request headers and the
  // in-flight chat count (abort propagation) via this snapshot
  [
    "GET",
    "/__state",
    (_req, _fx, state) => {
      return Response.json(stateSnapshot(state));
    },
  ],
  // test tooling: flip failure injection at runtime ({"mode": null} clears)
  [
    "POST",
    "/__fail",
    async (req, _fx, state) => {
      const body = (await req.json().catch(() => ({}))) as { mode?: unknown };
      const mode = body.mode ?? null;
      if (mode !== null && !FAIL_MODES.includes(mode as FailMode)) {
        return Response.json({ error: `unknown fail mode: ${String(mode)}` }, { status: 400 });
      }
      state.fail = mode as FailMode | null;
      return Response.json({ fail: state.fail });
    },
  ],
];

export function createApp(
  fixture: MockFixture = loadFixture(),
  state: MockServerState = {
    fail: null,
    lastHeaders: new Map(),
    inflight: 0,
  },
) {
  return {
    fetch(req: Request): Response | Promise<Response> {
      recordHeaders(state, req);
      const url = new URL(req.url);
      for (const [method, path, handler] of routes) {
        if (req.method === method && url.pathname === path) {
          return handler(req, fixture, state);
        }
      }
      return Response.json(
        { error: { message: `no route: ${req.method} ${url.pathname}` } },
        { status: 404 },
      );
    },
  };
}

/** Dev CORS: the browser SPA calls these endpoints cross-origin (client-only mode). */
const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export interface MockServerOptions {
  /** Emulate CORS-hostile providers (openrouter, bifrost): no access-control-*
   * headers and OPTIONS preflight rejected with 403. Default stays CORS `*`. */
  noCors?: boolean;
  /** start with a failure mode already active (see FailMode) */
  fail?: FailMode;
}

export function startServer(port: number, fixture?: MockFixture, opts: MockServerOptions = {}) {
  const state: MockServerState = { fail: opts.fail ?? null, lastHeaders: new Map(), inflight: 0 };
  const app = createApp(fixture, state);
  return Bun.serve({
    port,
    async fetch(req) {
      if (req.method === "OPTIONS")
        return opts.noCors
          ? new Response(null, { status: 403 })
          : new Response(null, { status: 204, headers: CORS_HEADERS });
      const res = await app.fetch(req);
      return opts.noCors ? res : withCors(res);
    },
  });
}

if (import.meta.main) {
  // accept `--port 9000`, `--port=9000` and bare flags like `--no-cors`
  const params = new URLSearchParams();
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!.replace(/^-+/, "");
    const next = argv[i + 1];
    if (arg.includes("=")) params.set(...(arg.split("=", 2) as [string, string]));
    else if (next !== undefined && !next.startsWith("-")) params.set(arg, argv[++i]!);
    else params.set(arg, "");
  }
  const port = Number(params.get("port") ?? 9000);
  const server = startServer(port, undefined, {
    noCors: params.has("no-cors"),
    ...(params.get("fail") ? { fail: params.get("fail") as FailMode } : {}),
  });
  console.log(`mock provider listening on http://localhost:${server.port}`);
}
