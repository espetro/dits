import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// Scenario source of truth lives in specs/e2e-wasm-voice.spec.md.
// Covers the wasm voice plan phases b-e in a real browser, without shipping
// the ~50MB real models: the `di.voice.models-base` localStorage override
// points the manifest+file fetches at page.route stubs whose sha256/size
// match what the spec computes here, and `window.Worker` is swapped for a
// recording mock that speaks the engine worker protocols. Requires the web
// dev server (DI_WEB_URL) only — no di server, all LLM traffic is routed.

const WEB_URL = process.env.DI_WEB_URL ?? "http://localhost:5173";
const MODELS_BASE = "/e2e/voice-models";

const PROFILE = {
  llm: {
    baseUrl: "http://mock.local/v1",
    apiKey: "test-key",
    model: "mock-model",
    mode: "remote",
  },
};

// tiny stand-in artifacts; the manifest below pins them by real sha256
const STUB_FILES: Record<string, Buffer> = {
  "stt/model.onnx": Buffer.from("e2e stub stt onnx", "utf8"),
  "stt/tokens.txt": Buffer.from("e2e stub tokens", "utf8"),
  "tts/model.onnx": Buffer.from("e2e stub tts onnx", "utf8"),
  "tts/voices.npz": Buffer.from("e2e stub voices", "utf8"),
};

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

const MANIFEST = {
  version: 1,
  models: {
    stt: {
      version: "e2e-stt-1",
      files: [
        {
          path: "stt/model.onnx",
          url: "stt/model.onnx",
          size: STUB_FILES["stt/model.onnx"].length,
          sha256: sha(STUB_FILES["stt/model.onnx"]),
        },
        {
          path: "stt/tokens.txt",
          url: "stt/tokens.txt",
          size: STUB_FILES["stt/tokens.txt"].length,
          sha256: sha(STUB_FILES["stt/tokens.txt"]),
        },
      ],
    },
    tts: {
      version: "e2e-tts-1",
      files: [
        {
          path: "tts/model.onnx",
          url: "tts/model.onnx",
          size: STUB_FILES["tts/model.onnx"].length,
          sha256: sha(STUB_FILES["tts/model.onnx"]),
        },
        {
          path: "tts/voices.npz",
          url: "tts/voices.npz",
          size: STUB_FILES["tts/voices.npz"].length,
          sha256: sha(STUB_FILES["tts/voices.npz"]),
        },
      ],
    },
  },
};

// modelFileKey() in apps/web/src/lib/voice/models.ts — keep in sync
function cacheKey(modelId: string, version: string, path: string): string {
  return `https://di.local/voice-models/${modelId}/${path}?v=${encodeURIComponent(version)}`;
}

function seedClientOnly(page: Page, extra: Record<string, string> = {}) {
  return page.addInitScript(
    ([mode, profile, base, kv]) => {
      localStorage.setItem("di.runtime-mode", mode as string);
      localStorage.setItem("di.provider-profile", JSON.stringify(profile));
      localStorage.setItem("di.voice.models-base", base as string);
      for (const [k, v] of Object.entries(kv as Record<string, string>)) {
        localStorage.setItem(k, v);
      }
    },
    ["custom", PROFILE, MODELS_BASE, extra] as const,
  );
}

// one route for the whole asset root — playwright prefers the last
// matching route, so a separate manifest route must not sit under a
// catch-all
async function routeModelFiles(page: Page, requested: string[]) {
  await page.route("**/e2e/voice-models/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/e2e/voice-models/", "");
    requested.push(path);
    if (path === "manifest.json") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MANIFEST),
      });
      return;
    }
    const bytes = STUB_FILES[path];
    if (!bytes) {
      await route.fulfill({ status: 404, body: "unknown e2e model file" });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/octet-stream", body: bytes });
  });
}

// Replaces window.Worker with a stub that speaks both engine protocols:
// stt (sherpa): init->ready, feed->partial, final after enough audio.
// tts (kitten): init->ready, speak->silent pcm. Calls land on __e2eVoice.
function mockVoiceWorkers(context: BrowserContext) {
  return context.addInitScript(() => {
    const log = { sttInits: 0, sttFeeds: 0, ttsInits: 0, ttsSpeaks: [] as string[] };
    (window as unknown as { __e2eVoice: typeof log }).__e2eVoice = log;
    class MockWorker {
      onmessage: ((ev: MessageEvent) => void) | null = null;
      onerror: ((ev: unknown) => void) | null = null;
      private kind: "stt" | "tts";
      constructor(url: string | URL) {
        this.kind = String(url).includes("stt-worker") ? "stt" : "tts";
      }
      private send(data: unknown) {
        queueMicrotask(() => this.onmessage?.({ data } as MessageEvent));
      }
      postMessage(msg: { type: string; id?: number; text?: string }) {
        if (this.kind === "stt") {
          if (msg.type === "init") {
            log.sttInits += 1;
            this.send({ type: "ready" });
          } else if (msg.type === "feed") {
            log.sttFeeds += 1;
            this.send({ type: "partial", text: "hello" });
            if (log.sttFeeds === 15) this.send({ type: "final", text: "hello from wasm" });
          }
        } else {
          if (msg.type === "init") {
            log.ttsInits += 1;
            this.send({ type: "ready" });
          } else if (msg.type === "speak") {
            log.ttsSpeaks.push(String(msg.text));
            this.send({ type: "pcm", id: msg.id, pcm: new Float32Array(4800) });
          }
        }
      }
      terminate() {}
    }
    (window as unknown as { Worker: typeof Worker }).Worker =
      MockWorker as unknown as typeof Worker;
  });
}

async function startClientOnlyInterview(page: Page): Promise<string> {
  await page.goto(`${WEB_URL}/setup`);
  await expect
    .poll(
      async () => {
        if (!/\/interview\//.test(page.url())) {
          await page.getByRole("button", { name: "start", exact: true }).first().click();
        }
        return /\/interview\//.test(page.url());
      },
      { timeout: 10_000, intervals: [500] },
    )
    .toBe(true);
  const match = /\/interview\/([^/?#]+)/.exec(page.url());
  if (!match) throw new Error(`unexpected url: ${page.url()}`);
  return match[1]!;
}

async function seedModelCache(page: Page) {
  const entries = [
    {
      key: cacheKey("stt", "e2e-stt-1", "stt/model.onnx"),
      bytes: [...STUB_FILES["stt/model.onnx"]],
    },
    {
      key: cacheKey("stt", "e2e-stt-1", "stt/tokens.txt"),
      bytes: [...STUB_FILES["stt/tokens.txt"]],
    },
    {
      key: cacheKey("tts", "e2e-tts-1", "tts/model.onnx"),
      bytes: [...STUB_FILES["tts/model.onnx"]],
    },
    {
      key: cacheKey("tts", "e2e-tts-1", "tts/voices.npz"),
      bytes: [...STUB_FILES["tts/voices.npz"]],
    },
  ];
  await page.evaluate(async (files) => {
    const cache = await caches.open("di-voice-models");
    for (const f of files) {
      await cache.put(f.key, new Response(new Uint8Array(f.bytes)));
    }
  }, entries);
}

async function cachedModelCount(page: Page): Promise<number> {
  return page.evaluate(async () => (await (await caches.open("di-voice-models")).keys()).length);
}

test.describe("wasm voice (mocked models + workers)", () => {
  test("consent dialog opens on first browser-mode entry and accept downloads the models", async ({
    page,
  }) => {
    const requested: string[] = [];
    await seedClientOnly(page);
    await routeModelFiles(page, requested);
    await startClientOnlyInterview(page);

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("better voice, on your device");

    await page.getByRole("button", { name: "download & enable" }).click();
    await expect(dialog).not.toBeVisible();

    // manifest + all four model files fetched and verified into the cache
    await expect.poll(async () => cachedModelCount(page), { timeout: 10_000 }).toBe(4);
    expect(requested).toEqual(
      expect.arrayContaining([
        "manifest.json",
        "stt/model.onnx",
        "stt/tokens.txt",
        "tts/model.onnx",
        "tts/voices.npz",
      ]),
    );
    expect(await page.evaluate(() => localStorage.getItem("di.voice.modelsConsent"))).toBe(
      "granted",
    );
  });

  test("decline keeps built-in engines and never re-asks", async ({ page }) => {
    const requested: string[] = [];
    await seedClientOnly(page);
    await routeModelFiles(page, requested);
    await startClientOnlyInterview(page);

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.getByRole("button", { name: "keep built-in" }).click();
    await expect(dialog).not.toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("di.voice.modelsConsent"))).toBe(
      "declined",
    );
    // no fetch happened and no nag on re-entry
    expect(requested).toEqual([]);
    await page.reload();
    await page.waitForTimeout(2_000);
    await expect(dialog).toHaveCount(0);
  });

  test("wasm engines run a full turn loop on mock workers", async ({ context, page }) => {
    await mockVoiceWorkers(context);
    await seedClientOnly(page, { "di.voice.modelsConsent": "granted" });
    await routeModelFiles(page, []);
    await page.route("**/v1/chat/completions", async (route) => {
      const chunk = { choices: [{ delta: { content: "mock wasm reply." } }] };
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
      });
    });

    await page.goto(`${WEB_URL}/setup`);
    await seedModelCache(page);
    await startClientOnlyInterview(page);

    // consent was granted and the cache is warm, so the driver picks the
    // sherpa worker path instead of SpeechRecognition
    await expect
      .poll(async () =>
        page.evaluate(
          () => (window as never as { __e2eVoice: { sttInits: number } }).__e2eVoice.sttInits,
        ),
      )
      .toBe(1);

    // fake-media mic feeds the worker; the mock emits a final which drives a
    // real agent turn -> routed llm reply -> wasm tts speak
    await expect(page.getByText("hello from wasm").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("mock wasm reply").first()).toBeVisible();
    const log = await page.evaluate(
      () =>
        (window as never as { __e2eVoice: { sttFeeds: number; ttsSpeaks: string[] } }).__e2eVoice,
    );
    expect(log.sttFeeds).toBeGreaterThan(0);
    expect(log.ttsSpeaks.length).toBeGreaterThan(0);
  });

  test("wasm voice spec md scenarios all have executed counterparts", () => {
    const md = readFileSync(new URL("./specs/e2e-wasm-voice.spec.md", import.meta.url), "utf8");
    const headings = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
    expect(headings.length).toBeGreaterThan(0);
    for (const h of headings) {
      expect(test.info().title, h).toBeTruthy();
    }
  });
});
