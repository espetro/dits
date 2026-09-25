import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface MockFixture {
  chat: { content: string }[];
  transcription: string;
  models: string[];
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

type Handler = (req: Request, fixture: MockFixture) => Response | Promise<Response>;

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
    (_req, fx) => {
      return Response.json({
        id: "chatcmpl-mock",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "mock-llm",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: fx.chat[0]!.content },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
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
    (_req, fx) => {
      return Response.json({
        object: "list",
        data: fx.models.map((id) => ({
          id,
          object: "model",
          owned_by: "mock",
        })),
      });
    },
  ],
  ["GET", "/health", () => Response.json({ ok: true })],
];

export function createApp(fixture: MockFixture = loadFixture()) {
  return {
    fetch(req: Request): Response | Promise<Response> {
      const url = new URL(req.url);
      for (const [method, path, handler] of routes) {
        if (req.method === method && url.pathname === path) {
          return handler(req, fixture);
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

export function startServer(port: number, fixture?: MockFixture) {
  const app = createApp(fixture);
  return Bun.serve({
    port,
    async fetch(req) {
      if (req.method === "OPTIONS")
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      return withCors(await app.fetch(req));
    },
  });
}

if (import.meta.main) {
  const port = Number(new URLSearchParams(process.argv.slice(2).join("&")).get("port") ?? 9000);
  const server = startServer(port);
  console.log(`mock provider listening on http://localhost:${server.port}`);
}
