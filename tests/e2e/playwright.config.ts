import { defineConfig } from "@playwright/test";

// Requires a running di server in test mode:
//   cd apps/server && DI_TEST_MODE=1 bun run src/cli.ts --config config.example.yaml --no-supervise
const baseURL = process.env.DI_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: ".",
  testMatch: ["*.spec.ts"],
  timeout: 15_000,
  reporter: [["list", { printSteps: false }]],
  use: {
    baseURL,
    trace: "off",
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
