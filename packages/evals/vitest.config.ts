import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Run under the bun runtime (`bun run --bun vitest run`) so bun:sqlite resolves.
  },
});
