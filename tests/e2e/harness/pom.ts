// Page objects: the only place that knows how the settings dialog and the
// interview screen are laid out. Specs talk in user terms; a copy or layout
// change is fixed here once.
import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

export type Layer = "stt" | "llm" | "tts";

const LAYER_LABEL: Record<Layer, string> = {
  stt: "stt layer",
  llm: "interviewer model",
  tts: "tts layer",
};

export function settingsPage(page: Page) {
  const layer = (name: Layer): Locator => page.getByTestId(`layer-test-${name}`);

  return {
    layer,

    async open(): Promise<void> {
      await page.goto("/?settings=1&pane=voice");
      await expect(layer("llm")).toBeVisible();
    },

    /** pick a layer option by its visible label, e.g. ("llm", "cloud endpoint") */
    async pickLayer(name: Layer, option: string): Promise<void> {
      await layer(name).getByRole("combobox", { name: LAYER_LABEL[name] }).click();
      await page.getByRole("option", { name: option }).click();
    },

    modelInput: (): Locator => page.getByRole("combobox", { name: "Model ID" }),
    modelOptions: (): Locator =>
      page.getByRole("listbox", { name: "Model ID" }).getByRole("option"),
    baseUrl: (): Locator => page.getByLabel("Base URL"),
    apiKey: (): Locator => page.getByRole("textbox", { name: /^API key/ }),

    /** the llm Test button; stt/tts rows use their own cta labels */
    testButton(name: Layer): Locator {
      const label = { llm: "test it", stt: "run test", tts: "play sample" }[name];
      return layer(name).getByRole("button", { name: label, exact: true });
    },

    /** the single status line a finished test leaves in the layer container */
    status: (name: Layer): Locator => layer(name).getByRole("status"),

    async expectStatus(name: Layer, text: string | RegExp, timeout = 10_000): Promise<void> {
      await expect(layer(name).getByRole("status")).toContainText(text, { timeout });
    },
  };
}

export function interviewPage(page: Page) {
  return {
    /**
     * Start from /setup. The start button only works after React hydrates and
     * seeded localStorage makes the first client render differ from SSR, so an
     * early click can be dropped: keep clicking until the SPA navigates.
     * Returns the session id.
     */
    async start(): Promise<string> {
      await page.goto("/setup");
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
    },

    async switchToTyping(): Promise<void> {
      await page.getByRole("button", { name: "switch to typing" }).click();
    },

    async send(text: string): Promise<void> {
      const input = page.getByPlaceholder("talk or type…");
      await input.fill(text);
      await input.press("Enter");
    },

    /** type one turn from the composer */
    async say(text: string): Promise<void> {
      await this.switchToTyping();
      await this.send(text);
    },

    transcript: (): Locator => page.getByRole("log"),
  };
}
