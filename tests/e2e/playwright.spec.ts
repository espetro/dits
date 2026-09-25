import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";

// Scenario source of truth lives in specs/e2e-text.spec.md (readable .md);
// this spec executes it. Requires di running in test mode:
//   cd apps/server && DI_TEST_MODE=1 bun run src/cli.ts --config config.example.yaml --no-supervise

let sessionId: string;

// Server-mode tests share one session via this beforeAll. It is registered on
// the server-mode describe (not root scope) so the client-only describe below
// runs without any di server.
test.describe("text mode (di server)", () => {
  test.beforeAll(async ({ request }) => {
    const res = await request.post("/v1/sessions", {
      data: { title: "e2e text", mode: "interview", duration_min: 15 },
    });
    expect(res.status()).toBe(201);
    sessionId = (await res.json()).id;
  });

  test("test mode is on", async ({ request }) => {
    const res = await request.get("/v1/test/ping");
    expect(res.ok()).toBeTruthy();
    expect(await res.json()).toEqual({ testMode: true });
  });

  test("created session appears in server state", async ({ request }) => {
    const res = await request.get("/v1/test/state");
    expect(res.ok()).toBeTruthy();
    const state = await res.json();
    const ids: string[] = state.sessions.map((s: { id: string }) => s.id);
    expect(ids).toContain(sessionId);
  });

  test("turns posted via api appear in session turns", async ({ request }) => {
    const turn = {
      id: crypto.randomUUID(),
      seq: 0,
      speaker: "user",
      text: "hello from e2e",
      created_at: new Date().toISOString(),
      source: "text",
    };
    const post = await request.post(`/v1/sessions/${sessionId}/turns`, {
      data: turn,
    });
    expect(post.status()).toBe(201);

    const res = await request.get(`/v1/sessions/${sessionId}/turns`);
    expect(res.ok()).toBeTruthy();
    const turns = await res.json();
    expect(turns).toContainEqual(
      expect.objectContaining({ speaker: "user", text: "hello from e2e" }),
    );
  });

  test("report round-trips through the api", async ({ request }) => {
    const report = {
      session_id: sessionId,
      overall_score: 7.2,
      coverage_pct: 80,
      competencies: [
        {
          name: "system design",
          score: 7,
          evidence: [{ quote: "shard by user id", turn_seq: 0, verdict: "worked" }],
        },
      ],
      model_answers: [],
      generated_at: new Date().toISOString(),
    };
    const put = await request.put(`/v1/sessions/${sessionId}/report`, {
      data: report,
    });
    expect(put.status()).toBe(200);

    const res = await request.get(`/v1/sessions/${sessionId}/report`);
    expect(res.ok()).toBeTruthy();
    const stored = await res.json();
    expect(stored.overall_score).toBe(7.2);
    expect(stored.competencies[0].evidence[0].quote).toBe("shard by user id");
  });

  test("tool state round-trips through the api", async ({ request }) => {
    const put = await request.put(`/v1/sessions/${sessionId}/tools`, {
      data: { editor: "def solve(): pass", whiteboard: '{"shapeCount":1}' },
    });
    expect(put.status()).toBe(200);

    const res = await request.get(`/v1/sessions/${sessionId}/tools`);
    expect(res.ok()).toBeTruthy();
    const tools = await res.json();
    expect(tools.editor).toBe("def solve(): pass");
    expect(tools.whiteboard).toContain("shapeCount");
  });

  // Keep the .md scenario and the executed spec in sync: every `## heading` in
  // the .md must have a corresponding test title here.
});

test("spec md scenarios all have executed counterparts", () => {
  const md = readFileSync(new URL("./specs/e2e-text.spec.md", import.meta.url), "utf8");
  const headings = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
  expect(headings.length).toBeGreaterThan(0);
  for (const h of headings) {
    expect(test.info().title, h).toBeTruthy();
  }
});

// Client-only runtime (ADR-0003): no di server at all, so this drives a real
// browser against the web dev server instead of `request`. The BYO
// provider's /v1/chat/completions is mocked via page.route — this validates
// the client-only wiring (OPFS, ClientAgent, turn source tagging), not a
// real LLM. Requires the web dev server running: cd apps/web && bun run dev
// (DI_WEB_URL to override, default http://localhost:5173).
test.describe("client-only runtime (no di server)", () => {
  const WEB_URL = process.env.DI_WEB_URL ?? "http://localhost:5173";
  // Storage keys mirror packages/shared/src/providers.ts RUNTIME_MODE_STORAGE_KEY /
  // PROVIDER_PROFILE_STORAGE_KEY; not imported since this package has no
  // workspace dependency on @di/shared.
  const PROFILE = {
    llm: {
      baseUrl: "http://mock.local/v1",
      apiKey: "test-key",
      model: "mock-model",
    },
  };

  async function seedClientOnly(page: Page) {
    await page.addInitScript(
      ([mode, profile]) => {
        localStorage.setItem("di.runtime-mode", mode as string);
        localStorage.setItem("di.provider-profile", JSON.stringify(profile));
      },
      ["custom", PROFILE] as const,
    );
  }

  async function readOpfsSession(page: Page, id: string) {
    return page.evaluate(async (sessionId) => {
      const opfsRoot = await navigator.storage.getDirectory();
      const dir = await opfsRoot.getDirectoryHandle("sessions");
      const handle = await dir.getFileHandle(`${sessionId}.json`);
      const file = await handle.getFile();
      return JSON.parse(await file.text());
    }, id);
  }

  async function startClientOnlySession(page: Page): Promise<string> {
    await seedClientOnly(page);
    await page.goto(`${WEB_URL}/setup`);
    // The submit button is only wired up after React hydrates; with seeded
    // localStorage the SSR tree differs from the first client render (the
    // provider-profile form appears), so hydration finishes a beat later and a
    // single early click can be dropped. Keep clicking until the SPA actually
    // navigates.
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
    const match = /\/interview\/([^\/?#]+)/.exec(page.url());
    if (!match) throw new Error(`unexpected url: ${page.url()}`);
    return match[1]!;
  }

  test("client-only session creation persists to OPFS", async ({ page }) => {
    const id = await startClientOnlySession(page);
    const record = await readOpfsSession(page, id);
    expect(record.session.id).toBe(id);
    expect(record.turns).toEqual([]);
  });

  test("typed turn round-trips through a mocked SSE response and appears in the transcript", async ({
    page,
  }) => {
    await page.route("**/v1/chat/completions", async (route) => {
      const chunk = { choices: [{ delta: { content: "mock agent reply" } }] };
      const body = `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`;
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body,
      });
    });
    // The driver's TTS path is exercised for every sentence; a mocked 500 keeps
    // the test on the speechSynthesis fallback and off the network.
    await page.route("**/v1/audio/speech", (route) =>
      route.fulfill({ status: 500, body: "no tts in e2e" }),
    );
    const id = await startClientOnlySession(page);
    // the type input lives in the collapsed transcript rail — the
    // ControlBar "type" button opens it and focuses the input (p3-22).
    await page.getByRole("button", { name: "type", exact: true }).click();
    const input = page.getByPlaceholder("talk or type…");
    await input.fill("hello from e2e");
    await input.press("Enter");

    await expect(page.getByText("mock agent reply")).toBeVisible();
    await expect(page.getByText("user · text")).toBeVisible();
    await expect(page.getByText("agent · text")).toBeVisible();

    const record = await readOpfsSession(page, id);
    expect(record.turns).toHaveLength(2);
    expect(record.turns[0]).toMatchObject({
      speaker: "user",
      text: "hello from e2e",
      source: "text",
    });
    expect(record.turns[1]).toMatchObject({
      speaker: "agent",
      text: "mock agent reply",
      source: "text",
    });
  });

  test("LLM failure does not persist an empty agent turn", async ({ page }) => {
    await page.route("**/v1/chat/completions", async (route) => {
      await route.fulfill({ status: 500, body: "mock failure" });
    });
    const id = await startClientOnlySession(page);
    await page.getByRole("button", { name: "type", exact: true }).click();
    const input = page.getByPlaceholder("talk or type…");
    await input.fill("this will fail");
    await input.press("Enter");

    await expect(page.getByText("user · text")).toBeVisible();
    // negative assertion: nothing else should ever show up, so poll briefly
    // instead of waiting on an event that (by design) never fires.
    await page.waitForTimeout(500);
    const record = await readOpfsSession(page, id);
    expect(record.turns).toHaveLength(1);
    expect(record.turns[0].speaker).toBe("user");
  });

  test("client-only spec md scenarios all have executed counterparts", () => {
    const md = readFileSync(new URL("./specs/e2e-client-only.spec.md", import.meta.url), "utf8");
    const headings = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
    expect(headings.length).toBeGreaterThan(0);
    for (const h of headings) {
      expect(test.info().title, h).toBeTruthy();
    }
  });
});
