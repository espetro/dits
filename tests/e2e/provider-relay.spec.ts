import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { DI_URL, MOCK_PORTS } from "./harness/env";
import { applySeed, staleFalse } from "./harness/seed";
import { settingsPage } from "./harness/pom";
import { readFileSync } from "node:fs";

// Scenario source of truth lives in specs/provider-relay.spec.md (readable
// .md); this spec executes it against the stack harness/up.ts starts. The
// no-CORS mock (--no-cors flips the browser-direct failure mode of
// openrouter/bifrost on: no ACAO headers, OPTIONS preflight 403) and the
// failure-injection mock are provided by up.ts on MOCK_PORTS.

const NOCOR_MOCK_PORT = MOCK_PORTS.noCors;
const CORS_MOCK_PORT = MOCK_PORTS.cors;
const FAIL_MOCK_PORT = MOCK_PORTS.fail;

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

async function setFail(port: number, mode: string | null): Promise<void> {
  await fetch(`http://localhost:${port}/__fail`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode }),
  });
}

test.describe("provider relay (no-CORS upstream via di server)", () => {
  test.afterEach(async () => {
    await setFail(FAIL_MOCK_PORT, null);
  });

  async function openSettingsLlm(page: Page) {
    await settingsPage(page).open();
  }

  async function chooseCloud(page: Page) {
    // the layer select defaults to demo; switch to "cloud endpoint"
    await settingsPage(page).pickLayer("llm", "cloud endpoint");
  }

  test("dropdown populates via relay, no-CORS upstream, keyless", async ({ page }) => {
    const errors = tapConsoleErrors(page);
    await openSettingsLlm(page);
    await chooseCloud(page);
    await settingsPage(page).baseUrl().fill(`http://localhost:${NOCOR_MOCK_PORT}/v1`);
    // no api key: keyless gateways (bifrost) are a first-class relay case

    const fixture = JSON.parse(
      readFileSync(`${repoRoot()}packages/evals/fixtures/default.json`, "utf8"),
    ) as { models: string[] };
    await settingsPage(page).modelInput().focus();
    await expect(settingsPage(page).modelOptions()).toHaveCount(fixture.models.length, {
      timeout: 5_000,
    });
    expect(await settingsPage(page).modelOptions().allTextContents()).toEqual(fixture.models);

    // the request went through the relay: recorded on the mock, no preflight
    // was ever needed. CORS blocks surface as console errors; none allowed.
    const state = await mockState(NOCOR_MOCK_PORT);
    expect(state.lastHeaders["/v1/models"]).toBeTruthy();
    expect(errors.filter((e) => /blocked by CORS/i.test(e))).toEqual([]);
  });

  test("dropdown populates via relay with key, no-CORS upstream", async ({ page }) => {
    const errors = tapConsoleErrors(page);
    await openSettingsLlm(page);
    await chooseCloud(page);
    await settingsPage(page).baseUrl().fill(`http://localhost:${NOCOR_MOCK_PORT}/v1`);
    await settingsPage(page).apiKey().fill("relay-test-key");

    const fixture = JSON.parse(
      readFileSync(`${repoRoot()}packages/evals/fixtures/default.json`, "utf8"),
    ) as { models: string[] };
    await settingsPage(page).modelInput().focus();
    await expect(settingsPage(page).modelOptions()).toHaveCount(fixture.models.length, {
      timeout: 5_000,
    });

    // authorization survives the relay hop (header allowlist forwards it)
    const state = await mockState(NOCOR_MOCK_PORT);
    expect(state.lastHeaders["/v1/models"]?.authorization).toBe("Bearer relay-test-key");
    expect(errors.filter((e) => /blocked by CORS/i.test(e))).toEqual([]);
  });

  test("chat through relay, no-CORS upstream", async ({ page }) => {
    const errors = tapConsoleErrors(page);
    await openSettingsLlm(page);
    await chooseCloud(page);
    await settingsPage(page).baseUrl().fill(`http://localhost:${NOCOR_MOCK_PORT}/v1`);
    await settingsPage(page).modelInput().fill("mock-llm");
    // sectionIncomplete marks a keyless non-demo llm incomplete: the Test
    // button stays disabled without an api key, so set one for this spec
    await settingsPage(page).apiKey().fill("relay-test-key");

    // Test button: streams one short completion through the relay
    await settingsPage(page).testButton("llm").click();
    await settingsPage(page).expectStatus("llm", "Working");

    // the mock recorded a chat request that carried no preflight problems
    const state = await mockState(NOCOR_MOCK_PORT);
    expect(state.lastHeaders["/v1/chat/completions"]).toBeTruthy();
    expect(errors.filter((e) => /blocked by CORS/i.test(e))).toEqual([]);
  });

  async function fillLlm(page: Page, baseUrl: string) {
    await openSettingsLlm(page);
    await chooseCloud(page);
    await settingsPage(page).baseUrl().fill(baseUrl);
    await settingsPage(page).modelInput().fill("mock-llm");
    await settingsPage(page).apiKey().fill("relay-test-key");
  }

  test("llm test surfaces upstream http 401 detail", async ({ page }) => {
    await setFail(FAIL_MOCK_PORT, "401");
    await fillLlm(page, `http://localhost:${FAIL_MOCK_PORT}/v1`);
    await settingsPage(page).testButton("llm").click();
    await settingsPage(page).expectStatus("llm", /model request failed \(401\)/);
    await settingsPage(page).expectStatus("llm", /invalid api key \(mock 401\)/);
  });

  test("models html 200 shows not a model list", async ({ page }) => {
    await setFail(FAIL_MOCK_PORT, "html-models");
    await fillLlm(page, `http://localhost:${FAIL_MOCK_PORT}/v1`);
    await expect(page.getByRole("alert").filter({ hasText: /not a model list/ })).toBeVisible({
      timeout: 5_000,
    });
  });

  test("models html 200 on a root base url suggests the working /v1", async ({ page }) => {
    await setFail(FAIL_MOCK_PORT, "html-root");
    await fillLlm(page, `http://localhost:${FAIL_MOCK_PORT}`);
    const alert = page.getByRole("alert").filter({ hasText: /no model list at this base URL/ });
    await expect(alert).toBeVisible({ timeout: 5_000 });
    await expect(alert).toContainText(`http://localhost:${FAIL_MOCK_PORT}/v1`);
  });

  test("llm test surfaces an in-band sse error", async ({ page }) => {
    await setFail(FAIL_MOCK_PORT, "sse-error");
    await fillLlm(page, `http://localhost:${FAIL_MOCK_PORT}/v1`);
    await settingsPage(page).testButton("llm").click();
    await settingsPage(page).expectStatus("llm", /upstream exploded \(mock in-band error\)/);
  });

  test("abort propagates, no zombie upstream", async ({ page }) => {
    // a chat request that is aborted client-side must drain the mock's
    // in-flight count to zero: the relay forwards c.req.raw.signal upstream
    const ctrl = new AbortController();
    const res = await fetch(
      `${DI_URL}/v1/relay?url=${encodeURIComponent(`http://localhost:${NOCOR_MOCK_PORT}/v1/chat/completions`)}`,
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
    // the page under test is the fallback SPA (no di server behind it); the
    // CORS-enabled mock on MOCK_PORTS.cors is the upstream
    await applySeed(page, staleFalse());
    const settings = settingsPage(page);
    await settings.open(base);
    await settings.pickLayer("llm", "cloud endpoint");
    await settings.baseUrl().fill(`http://localhost:${CORS_MOCK_PORT}/v1`);
    await settings.apiKey().fill("fallback-key");

    const fixture = JSON.parse(
      readFileSync(`${repoRoot()}packages/evals/fixtures/default.json`, "utf8"),
    ) as { models: string[] };
    await settingsPage(page).modelInput().focus();
    await expect(settingsPage(page).modelOptions()).toHaveCount(fixture.models.length, {
      timeout: 5_000,
    });
    expect(errors.filter((e) => /blocked by CORS/i.test(e))).toEqual([]);
  });
});
