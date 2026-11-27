import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { DI_URL, STATIC_URL } from "./harness/env";
import { interviewPage } from "./harness/pom";
import { applySeed, profileKey, publicSite } from "./harness/seed";

/**
 * Public static-site golden path. The static harness serves the same built
 * SPA without a di server; `di.public-site` is the harness-side runtime
 * override for the flag production static builds bake in. Scenario source of
 * truth: specs/static-golden-path.spec.md.
 */

function sseBody(text: string): string {
  const chunk = { choices: [{ delta: { content: text } }] };
  return `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`;
}

async function mockProvider(page: Page): Promise<void> {
  await page.route("**/v1/chat/completions", async (route) => {
    const body = route.request().postData() ?? "";
    if (body.includes("overall_score")) {
      const sid = /session_id:\s*([0-9a-f-]{36})/i.exec(body)?.[1] ?? crypto.randomUUID();
      const report = {
        session_id: sid,
        overall_score: 8,
        coverage_pct: 70,
        competencies: [
          {
            name: "mock competency",
            score: 8,
            evidence: [{ quote: "hello from static", turn_seq: 0, verdict: "worked" }],
          },
        ],
        model_answers: [],
        generated_at: new Date().toISOString(),
      };
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: sseBody(JSON.stringify(report)),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sseBody("mock agent reply"),
    });
  });
}

test.describe("static public-site golden path", () => {
  test("di-hosted landing keeps direct setup path without install ui", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "download the app" })).toHaveCount(0);
    await page.getByRole("link", { name: "grill me" }).click();
    await expect(page).toHaveURL(/\/setup\/?$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("landing to report runs client-only without di server api calls @smoke", async ({
    page,
  }) => {
    const apiCalls: string[] = [];
    const providerCalls: string[] = [];
    const apiOrigins = new Set([new URL(STATIC_URL).origin, new URL(DI_URL).origin]);
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        apiOrigins.has(url.origin) &&
        (url.pathname.startsWith("/api/") || url.pathname.startsWith("/v1/"))
      ) {
        apiCalls.push(request.url());
      }
      if (url.origin === "http://mock.local") providerCalls.push(request.url());
    });

    await mockProvider(page);
    await applySeed(page, publicSite(), profileKey());

    const interview = interviewPage(page);
    await interview.startFromLanding(STATIC_URL);
    await interview.say("hello from static");
    await expect(page.getByText("mock agent reply").first()).toBeVisible();
    await expect(page.getByText("you · text").first()).toBeVisible();

    await interview.endEarly();
    await expect(page).toHaveURL(/\/report\//, { timeout: 15_000 });
    await expect(page.getByText("mock competency")).toBeVisible();

    // The provider's own /v1/chat/completions is expected traffic; /api/* and
    // same-origin /v1/* are di server API surface and must stay untouched.
    expect(providerCalls.some((url) => url.includes("/v1/chat/completions"))).toBe(true);
    expect(apiCalls).toEqual([]);
  });
});
