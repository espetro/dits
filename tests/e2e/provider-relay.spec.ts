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
const FAIL_MOCK_PORT = Number(process.env.MOCK_FAIL_PORT ?? 9102);

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

// The model id field is a combobox whose listbox carries the same accessible
// name, so role-scoped locators are required (getByLabel is ambiguous).
// Focusing the input opens the list.
function modelInput(page: Page) {
  return page.getByRole("combobox", { name: "Model ID" });
}

function modelOptions(page: Page) {
  return page.getByRole("listbox", { name: "Model ID" }).getByRole("option");
}

let noCorsMock: ChildProcess | null = null;
let failMock: ChildProcess | null = null;

async function mockUp(port: number): Promise<boolean> {
  try {
    return (await fetch(`http://localhost:${port}/health`)).ok;
  } catch {
    return false;
  }
}

// null when a mock (e.g. from harness/up.ts) already listens on the port
async function spawnMock(port: number, extra: string[] = []): Promise<ChildProcess | null> {
  if (await mockUp(port)) return null;
  return spawn(
    "bun",
    ["run", `${repoRoot()}packages/evals/mock-provider/main.ts`, "--port", String(port), ...extra],
    { stdio: "ignore", detached: true },
  );
}

async function waitMock(port: number): Promise<void> {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/health`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`mock provider never became ready on :${port}`);
}

function killMock(child: ChildProcess | null): void {
  if (!child?.pid) return;
  try {
    // detached + negative pid kills the whole process group
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // already gone
  }
}

async function setFail(port: number, mode: string | null): Promise<void> {
  await fetch(`http://localhost:${port}/__fail`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode }),
  });
}

test.describe("provider relay (no-CORS upstream via di server)", () => {
  test.beforeAll(async () => {
    // CORS-hostile mock; separate failure-injection mock so flipping modes
    // never races the happy-path specs on the shared no-CORS mock
    noCorsMock = await spawnMock(NOCOR_MOCK_PORT, ["--no-cors"]);
    failMock = await spawnMock(FAIL_MOCK_PORT, ["--no-cors"]);
    await waitMock(NOCOR_MOCK_PORT);
    await waitMock(FAIL_MOCK_PORT);
  });

  test.afterEach(async () => {
    await setFail(FAIL_MOCK_PORT, null);
  });

  test.afterAll(() => {
    killMock(failMock);
    killMock(noCorsMock);
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
    await modelInput(page).focus();
    await expect(modelOptions(page)).toHaveCount(fixture.models.length, { timeout: 5_000 });
    expect(await modelOptions(page).allTextContents()).toEqual(fixture.models);

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
    await page.getByLabel("Base URL").fill(`http://localhost:${NOCOR_MOCK_PORT}/v1`);
    await page.getByRole("textbox", { name: /^API key/ }).fill("relay-test-key");

    const fixture = JSON.parse(
      readFileSync(`${repoRoot()}packages/evals/fixtures/default.json`, "utf8"),
    ) as { models: string[] };
    await modelInput(page).focus();
    await expect(modelOptions(page)).toHaveCount(fixture.models.length, { timeout: 5_000 });

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
    await modelInput(page).fill("mock-llm");
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

  async function fillLlm(page: Page, baseUrl: string) {
    await openSettingsLlm(page);
    await chooseCloud(page);
    await page.getByLabel("Base URL").fill(baseUrl);
    await modelInput(page).fill("mock-llm");
    await page.getByRole("textbox", { name: /^API key/ }).fill("relay-test-key");
  }

  test("llm test surfaces upstream http 401 detail", async ({ page }) => {
    await setFail(FAIL_MOCK_PORT, "401");
    await fillLlm(page, `http://localhost:${FAIL_MOCK_PORT}/v1`);
    await page.getByRole("button", { name: "test it", exact: true }).click();
    await expect(page.getByText(/model request failed \(401\)/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/invalid api key \(mock 401\)/).first()).toBeVisible();
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
    await page.getByRole("button", { name: "test it", exact: true }).click();
    await expect(page.getByText(/upstream exploded \(mock in-band error\)/).first()).toBeVisible({
      timeout: 10_000,
    });
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
    await modelInput(page).focus();
    await expect(modelOptions(page)).toHaveCount(fixture.models.length, { timeout: 5_000 });
    expect(errors.filter((e) => /blocked by CORS/i.test(e))).toEqual([]);
  });
});
