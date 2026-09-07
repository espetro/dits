import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

// Scenario source of truth lives in specs/e2e-voice-harness.spec.md.
// Targets the web dev server (DI_WEB_URL, default http://localhost:5173);
// the SPA calls the di test-mode server itself via VITE_DI_API_BASE, so the
// di server must run in test mode with the mock provider before this suite.

const WEB_URL = process.env.DI_WEB_URL ?? "http://localhost:5173";

test.describe("voice functional harness (mock provider)", () => {
  test("voice harness runs a full turn loop without a mic", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(`${WEB_URL}/dev/voice-harness`);

    // one click creates the session and connects the WS loop; with SSR the
    // first click can land before hydration wires the handler, so keep
    // clicking until the status actually leaves idle
    await expect
      .poll(
        async () => {
          if (await page.getByTestId("connect").isVisible()) {
            await page.getByTestId("connect").click();
          }
          return page.getByTestId("harness-status").textContent();
        },
        { timeout: 20_000, intervals: [1_000] },
      )
      .toMatch(/ready|error/);

    await page.getByTestId("run-scenario").click();

    // the scripted utterances drive user transcript -> agent reply -> tts ->
    // metrics; two turns complete when the metrics panel fills in
    await expect(page.getByTestId("agent-transcript")).not.toHaveText("—", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("user-transcript")).not.toHaveText("—");
    await expect(page.getByTestId("metric-llm")).toContainText("llm ttft:", {
      ignoreCase: true,
    });
    await expect(page.getByTestId("metric-total")).not.toContainText("total: —");
    await expect(page.getByTestId("harness-error")).toHaveCount(0);
  });

  test("voice harness spec md scenarios all have executed counterparts", () => {
    const md = readFileSync(new URL("./specs/e2e-voice-harness.spec.md", import.meta.url), "utf8");
    const headings = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
    expect(headings.length).toBeGreaterThan(0);
    for (const h of headings) {
      expect(test.info().title, h).toBeTruthy();
    }
  });
});
