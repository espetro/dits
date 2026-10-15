import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { MOCK_PORTS } from "./harness/env";
import { settingsPage } from "./harness/pom";
import {
  KEYS,
  applySeed,
  fresh,
  profileKey,
  staleFalse,
  staleTrueServerDown,
} from "./harness/seed";
import type { Seed } from "./harness/seed";

// Settings matrix: provider layer x di-server state x CORS x key. Scenario
// source of truth is specs/settings-matrix.spec.md. This file owns its own
// mocks (mxCors / mxNoCors) so failure injection and recorded headers never
// race the relay spec, which runs in parallel in another worker.

const CORS = `http://localhost:${MOCK_PORTS.mxCors}/v1`;
const NO_CORS = `http://localhost:${MOCK_PORTS.mxNoCors}/v1`;

const fixture = JSON.parse(
  readFileSync(new URL("../../packages/evals/fixtures/default.json", import.meta.url), "utf8"),
) as { models: string[] };

async function setFail(port: number, mode: string | null): Promise<void> {
  await fetch(`http://localhost:${port}/__fail`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode }),
  });
}

function tapCorsErrors(page: Page): () => string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return () => errors.filter((e) => /cors/i.test(e));
}

async function openCloudLlm(page: Page, seeds: Seed[], baseUrl: string, apiKey = "mx-key") {
  await applySeed(page, ...seeds);
  const settings = settingsPage(page);
  await settings.open();
  await settings.pickLayer("llm", "cloud endpoint");
  await settings.baseUrl().fill(baseUrl);
  if (apiKey) await settings.apiKey().fill(apiKey);
  return settings;
}

test.describe("settings matrix", () => {
  test.afterEach(async () => {
    await setFail(MOCK_PORTS.mxCors, null);
    await setFail(MOCK_PORTS.mxNoCors, null);
  });

  test("S1 fresh visitor, cors-off endpoint: list populates and Test works @smoke", async ({
    page,
  }) => {
    const corsErrors = tapCorsErrors(page);
    const settings = await openCloudLlm(page, [fresh()], NO_CORS);
    await settings.modelInput().focus();
    await expect(settings.modelOptions()).toHaveCount(fixture.models.length);
    await settings.modelInput().fill("mock-llm");
    await settings.testButton("llm").click();
    await settings.expectStatus("llm", "Working");
    expect(corsErrors()).toEqual([]);
  });

  test("S2 stale unreachable cache, cors-off endpoint: list populates once the probe settles @smoke", async ({
    page,
  }) => {
    const corsErrors = tapCorsErrors(page);
    const settings = await openCloudLlm(page, [staleFalse()], NO_CORS);
    await settings.modelInput().focus();
    await expect(settings.modelOptions()).toHaveCount(fixture.models.length);
    await settings.modelInput().fill("mock-llm");
    await settings.testButton("llm").click();
    await settings.expectStatus("llm", "Working");
    expect(corsErrors()).toEqual([]);
  });

  test("S3 Test clicked while the health probe is still in flight gives a precise result @smoke", async ({
    page,
  }) => {
    const corsErrors = tapCorsErrors(page);
    await page.route("**/api/health", async (route) => {
      await new Promise((r) => setTimeout(r, 500));
      await route.continue();
    });
    const settings = await openCloudLlm(page, [staleFalse()], NO_CORS);
    await settings.modelInput().fill("mock-llm");
    await settings.testButton("llm").click();
    await settings.expectStatus("llm", /Working|Failed: .{8,}/, 15_000);
    await expect(settings.status("llm")).not.toContainText(/failed to fetch|load failed/i);
    expect(corsErrors()).toEqual([]);
  });

  test("S4 server gone but cache says reachable: cors-on works, cors-off names CORS", async ({
    page,
  }) => {
    const settings = await openCloudLlm(page, [staleTrueServerDown()], CORS);
    await settings.modelInput().fill("mock-llm");
    await settings.testButton("llm").click();
    await settings.expectStatus("llm", "Working");

    await settings.baseUrl().fill(NO_CORS);
    await settings.testButton("llm").click();
    await settings.expectStatus("llm", /cors/i);
  });

  test("S5 key and keyless against cors-on and cors-off", async ({ page }) => {
    const settings = await openCloudLlm(page, [fresh()], NO_CORS, "");
    await settings.modelInput().focus();
    await expect(settings.modelOptions()).toHaveCount(fixture.models.length);
    // localhost endpoints do not need a key (keyless gateways are first-class)
    await settings.modelInput().fill("mock-llm");
    await settings.testButton("llm").click();
    await settings.expectStatus("llm", "Working");
    const readState = async () =>
      (await (await fetch(`http://localhost:${MOCK_PORTS.mxNoCors}/__state`)).json()) as {
        lastHeaders: Record<string, Record<string, string>>;
      };
    expect((await readState()).lastHeaders["/v1/chat/completions"]?.authorization).toBeUndefined();

    await settings.apiKey().fill("mx-key-1");
    await settings.testButton("llm").click();
    await expect
      .poll(async () => (await readState()).lastHeaders["/v1/chat/completions"]?.authorization)
      .toBe("Bearer mx-key-1");

    await settings.baseUrl().fill(CORS);
    await settings.testButton("llm").click();
    await settings.expectStatus("llm", "Working");
  });

  test("S6 stt and tts rows: server and cloud picks report a result @smoke", async ({ page }) => {
    // a profile needs its llm section before a tts section can persist
    await applySeed(page, profileKey());
    const settings = settingsPage(page);
    await settings.open();

    await settings.pickLayer("stt", "desktop app");
    await settings.testButton("stt").click();
    await settings.expectStatus("stt", /./, 20_000);
    await expect(settings.status("stt")).not.toContainText(/failed/i);

    await settings.pickLayer("tts", "desktop app");
    await settings.testButton("tts").click();
    await settings.expectStatus("tts", "Working");

    await settings.pickLayer("tts", "cloud endpoint");
    await settings.layer("tts").getByLabel("Base URL").fill(CORS);
    await settings
      .layer("tts")
      .getByRole("textbox", { name: /^API key/ })
      .fill("mx-key");
    await settings.layer("tts").getByRole("combobox", { name: "Model ID" }).fill("mock-tts");
    // the engine resolves from the persisted profile, and autosave is debounced
    await expect
      .poll(() => page.evaluate((k) => localStorage.getItem(k) ?? "", KEYS.profile))
      .toContain("mock-tts");
    await settings.testButton("tts").click();
    await settings.expectStatus("tts", "Working");
  });

  test("S7 model combobox states: loading, populated, empty, error, keyboard pick @smoke", async ({
    page,
  }) => {
    const settings = await openCloudLlm(page, [staleFalse()], CORS);
    const list = page.getByRole("listbox", { name: "Model ID" });

    await settings.modelInput().focus();
    await expect(settings.modelOptions()).toHaveCount(fixture.models.length);

    // keyboard select persists
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    const picked = await settings.modelInput().inputValue();
    expect(fixture.models).toContain(picked);
    // autosave is debounced: wait for the profile to carry the pick
    await expect
      .poll(() => page.evaluate((k) => localStorage.getItem(k) ?? "", KEYS.profile))
      .toContain(picked);
    await page.reload();
    await settings.modelInput().focus();
    await expect(settings.modelInput()).toHaveValue(picked);

    // empty list
    await setFail(MOCK_PORTS.mxCors, "empty-models");
    await settings.baseUrl().fill(`${CORS}/`);
    await settings.baseUrl().fill(CORS);
    await settings.modelInput().fill("");
    await settings.modelInput().focus();
    await expect(list.getByText("no models returned by this endpoint")).toBeVisible();

    // html 200
    await setFail(MOCK_PORTS.mxCors, "html-models");
    await settings.baseUrl().fill(`${CORS}/`);
    await settings.baseUrl().fill(CORS);
    await settings.modelInput().focus();
    await expect(list.getByRole("alert")).toContainText(/not a model list/);

    // 401
    await setFail(MOCK_PORTS.mxCors, "401");
    await settings.baseUrl().fill(`${CORS}/`);
    await settings.baseUrl().fill(CORS);
    await settings.modelInput().focus();
    await expect(list.getByRole("alert")).toContainText(/401|invalid api key/i);
  });

  test("S8 slow reasoning model: pending, then ok, no timeout", async ({ page }) => {
    await setFail(MOCK_PORTS.mxCors, "slow-reasoning");
    const settings = await openCloudLlm(page, [staleFalse()], CORS);
    await settings.modelInput().fill("mock-llm");
    await settings.testButton("llm").click();
    await expect(settings.layer("llm").getByRole("button", { name: /testing/i })).toBeVisible();
    await settings.expectStatus("llm", "Working", 15_000);
  });

  test("settings matrix spec md scenarios all have executed counterparts", () => {
    const md = readFileSync(new URL("./specs/settings-matrix.spec.md", import.meta.url), "utf8");
    const headings = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1]!.trim());
    expect(headings.length).toBeGreaterThan(0);
    const src = readFileSync(new URL(import.meta.url), "utf8");
    for (const h of headings) {
      expect(src, `no test titled for: ${h}`).toContain(h.replace(/ @smoke$/, ""));
    }
  });
});
