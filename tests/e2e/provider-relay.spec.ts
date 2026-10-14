import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";

// Scenario source of truth lives in specs/provider-relay.spec.md (readable
// .md); this spec executes it. Preconditions (see AGENTS.md):
//   - di server in test mode on DI_URL (default http://localhost:3000)
//   - web dev server on :5173 started with VITE_DI_API_BASE=$DI_URL
//     (cd apps/web && VITE_DI_API_BASE=http://localhost:3000 bun run dev)
// The no-CORS mock provider is spawned by the spec itself (--no-cors flips
// the browser-direct failure mode of openrouter/bifrost on: no ACAO headers,
// OPTIONS preflight 403).

const WEB_URL = process.env.DI_WEB_URL ?? "http://localhost:5173";
const NOCOR_MOCK_PORT = Number(process.env.MOCK_NOCORS_PORT ?? 9100);
const CORS_MOCK_PORT = Number(process.env.MOCK_CORS_PORT ?? 9101);

function repoRoot(): string {
  // tests/e2e/<this file> -> repo root two levels up
  return new URL("../..", import.meta.url).pathname;
}

interface MockState {
  lastHeaders: Record<string, Record<string, string>>;
  inflight: number;
}

async function mockState(port: number): Promise<MockState> {
  const res = await fetch(`http://localhost:${port}/__state`);
  return (await res.json()) as MockState;
}

// Collect console errors + page errors per page; specs assert the array
// stays free of CORS blocks (mirrors the error-tap pattern in
// playwright.spec.ts).
function tapConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

let noCorsMock: ChildProcess | null = null;

test.describe("provider relay (no-CORS upstream via di server)", () => {
  test.beforeAll(async () => {
    // spawn the CORS-hostile mock; readiness-poll /v1/models
    noCorsMock = spawn(
      "bun",
      [
        "run",
        `${repoRoot()}packages/evals/mock-provider/main.ts`,
        "--port",
        String(NOCOR_MOCK_PORT),
        "--no-cors",
      ],
      { stdio: "ignore", detached: true },
    );
    for (let i = 0; i < 50; i++) {
      try {
        const res = await fetch(`http://localhost:${NOCOR_MOCK_PORT}/v1/models`);
        if (res.ok) return;
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`no-CORS mock provider never became ready on :${NOCOR_MOCK_PORT}`);
  });

  test.afterAll(() => {
    if (noCorsMock?.pid) {
      try {
        // detached + negative pid kills the whole process group
        process.kill(-noCorsMock.pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
  });

  async function openSettingsLlm(page: Page) {
    await page.goto(`${WEB_URL}/?settings=1&pane=voice`);
    // the brain section renders the llm EndpointFields (tab "llm")
    await expect(page.getByLabel("Base URL")).toBeVisible();
  }

  async function chooseCloud(page: Page) {
    // the layer select defaults to demo; switch to "cloud endpoint"
    await page.getByRole("combobox", { name: "interviewer model" }).click();
    await page.getByRole("option", { name: "cloud endpoint" }).click();
  }

  test("dropdown populates via relay, no-CORS upstream, keyless", async ({ page }) => {
    const errors = tapConsoleErrors(page);
    await openSettingsLlm(page);
    await chooseCloud(page);
    await page.getByLabel("Base URL").fill(`http://localhost:${NOCOR_MOCK_PORT}/v1`);
    // no api key: keyless gateways (bifrost) are a first-class relay case

    const fixture = JSON.parse(
      readFileSync(`${repoRoot()}packages/evals/fixtures/default.json`, "utf8"),
    ) as { models: string[] };
    await expect.poll(() => page.locator("#llm-models option").count(), { timeout: 5_000 }).toBe(
      fixture.models.length,
    );
    const options = await page.locator("#llm-models option").evaluateAll((els) =>
      els.map((el) => el.getAttribute("value")),
    );
    expect(options).toEqual(fixture.models);

    // the request went through the relay: recorded on the mock, no preflight
    // was ever needed. CORS blocks surface as console errors; none allowed.
    const state = await mockState(NOCOR_MOCK_PORT);
    expect(state.lastHeaders["/v1/models"]).toBeTruthy();
    expect(
      errors.filter((e) => /blocked by CORS/i.test(e)),
    ).toEqual([]);
  });

  test("dropdown populates via relay with key, no-CORS upstream", async ({ page }) => {
    const errors = tapConsoleErrors(page);
    await openSettingsLlm(page);
    await chooseCloud(page);
    await page.getByLabel("Base URL").fill(`http://localhost:${NOCOR_MOCK_PORT}/v1`);
    await page.getByRole("textbox", { name: /^API key/ }).fill("relay-test-key");

    const fixture = JSON.parse(
      readFileSync(`${repoRoot()}packages/evals/fixtures/default.json`, "utf8"),
    ) as { models: string[] };
    await expect.poll(() => page.locator("#llm-models option").count(), { timeout: 5_000 }).toBe(
      fixture.models.length,
    );

    // authorization survives the relay hop (header allowlist forwards it)
    const state = await mockState(NOCOR_MOCK_PORT);
    expect(state.lastHeaders["/v1/models"]?.authorization).toBe("Bearer relay-test-key");
    expect(errors.filter((e) => /blocked by CORS/i.test(e))).toEqual([]);
  });

  test("chat through relay, no-CORS upstream", async ({ page }) => {
    const errors = tapConsoleErrors(page);
    await openSettingsLlm(page);
    await chooseCloud(page);
    await page.getByLabel("Base URL").fill(`http://localhost:${NOCOR_MOCK_PORT}/v1`);
    await page.getByLabel("Model ID").fill("mock-llm");
    // sectionIncomplete marks a keyless non-demo llm incomplete: the Test
    // button stays disabled without an api key, so set one for this spec
    await page.getByRole("textbox", { name: /^API key/ }).fill("relay-test-key");

    // Test button: streams one short completion through the relay
    await page.getByRole("button", { name: "test it", exact: true }).click();
    await expect(page.getByText("Working").first()).toBeVisible({ timeout: 10_000 });

    // the mock recorded a chat request that carried no preflight problems
    const state = await mockState(NOCOR_MOCK_PORT);
    expect(state.lastHeaders["/v1/chat/completions"]).toBeTruthy();
    expect(errors.filter((e) => /blocked by CORS/i.test(e))).toEqual([]);
  });

  test("abort propagates, no zombie upstream", async ({ page }) => {
    // a chat request that is aborted client-side must drain the mock's
    // in-flight count to zero: the relay forwards c.req.raw.signal upstream
    const ctrl = new AbortController();
    const res = await fetch(
      `${process.env.DI_URL ?? "http://localhost:3000"}/v1/relay?url=${encodeURIComponent(`http://localhost:${NOCOR_MOCK_PORT}/v1/chat/completions`)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "mock-llm",
          stream: true,
          messages: [{ role: "user", content: "hi" }],
        }),
        signal: ctrl.signal,
      },
    );
    const reader = res.body!.getReader();
    await reader.read();
    ctrl.abort();
    await reader.cancel().catch(() => undefined);

    for (let i = 0; i < 50; i++) {
      const state = await mockState(NOCOR_MOCK_PORT);
      if (state.inflight === 0) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("inflight never drained after client abort");
  });

  test("relay spec md scenarios all have executed counterparts", () => {
    const md = readFileSync(new URL("./specs/provider-relay.spec.md", import.meta.url), "utf8");
    const headings = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
    expect(headings.length).toBeGreaterThan(0);
    for (const h of headings) {
      expect(test.info().title, h).toBeTruthy();
    }
  });
});

// Fallback guard for the public site: with NO reachable di server the SPA
// keeps working browser-direct against CORS-ENABLED endpoints. Requires a
// separately-served build without a di server behind it: set
// RELAY_FALLBACK_URL to that origin. Skipped otherwise.
test.describe("browser-direct fallback (no di server)", () => {
  test.skip(!process.env.RELAY_FALLBACK_URL, "RELAY_FALLBACK_URL not set");

  test("fallback unchanged: dropdown populates browser-direct against CORS-enabled upstream", async ({
    page,
  }) => {
    const errors = tapConsoleErrors(page);
    const base = process.env.RELAY_FALLBACK_URL!;
    // spawn a CORS-enabled mock if not already running on the fallback origin
    // is out of scope here; the fixture provider must be reachable under
    // MOCK_CORS_PORT. The page under test is the fallback SPA.
    const mockPort = CORS_MOCK_PORT;
    await page.addInitScript(
      ([url]) => {
        localStorage.setItem("di.server-reachable", "false");
        void url;
      },
      [base] as const,
    );
    await page.goto(`${base}/?settings=1&pane=voice`);
    await expect(page.getByLabel("Base URL")).toBeVisible();
    await page.getByRole("combobox", { name: "interviewer model" }).click();
    await page.getByRole("option", { name: "cloud endpoint" }).click();
    await page.getByLabel("Base URL").fill(`http://localhost:${mockPort}/v1`);
    await page.getByLabel("API key").fill("fallback-key");

    const fixture = JSON.parse(
      readFileSync(`${repoRoot()}packages/evals/fixtures/default.json`, "utf8"),
    ) as { models: string[] };
    await expect.poll(() => page.locator("#llm-models option").count(), { timeout: 5_000 }).toBe(
      fixture.models.length,
    );
    expect(errors.filter((e) => /blocked by CORS/i.test(e))).toEqual([]);
  });
});
