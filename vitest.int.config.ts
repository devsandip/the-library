import { defineConfig } from "vitest/config";

// Integration tests against the deployed dev stack. Serial: they share one table.
export default defineConfig({
  test: {
    include: ["**/test/**/*.int.test.ts"],
    exclude: ["**/node_modules/**", "scratch/**"],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
});
