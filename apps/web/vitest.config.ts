import { defineConfig } from "vitest/config";

// The web app is a TanStack Start SPA; its vite config enables the
// "react-server" resolve condition, which makes "react" resolve to the
// react-server build inside vitest (no hooks dispatcher). Tests run in the
// plain client environment, so drop the extra conditions here.
export default defineConfig({
  test: {
    environment: "jsdom",
  },
  resolve: {
    conditions: [],
  },
});
