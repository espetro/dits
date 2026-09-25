import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // bun:sqlite is a Bun built-in; alias to a stub so vitest/node can load it.
  },
});
