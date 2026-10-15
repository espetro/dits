import { defineConfig } from "@playwright/test";

// Run through `bun harness/up.ts` (mise run e2e): it serves the built SPA
// behind a test-mode di server on :3100 and sets DI_URL / DI_WEB_URL. The
// :3100 default makes a bare `playwright test` target the same stack when
// one is already up.
const baseURL = process.env.DI_URL ?? "http://localhost:3100";

export default defineConfig({
  testDir: ".",
  testMatch: ["*.spec.ts"],
  timeout: 15_000,
  reporter: [["list", { printSteps: false }], ["./harness/summary-reporter.ts"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // wasm-voice spec exercises the real mic path: fake device + autoplay
    // so getUserMedia and AudioContext work headless
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
  },
});
