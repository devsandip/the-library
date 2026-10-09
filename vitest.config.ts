import { defineConfig } from "vitest/config";

// Unit tests: local only, no AWS. Integration tests are *.int.test.ts (see vitest.int.config.ts).
export default defineConfig({
  test: {
    include: ["**/test/**/*.test.ts"],
    exclude: ["**/*.int.test.ts", "**/node_modules/**", "scratch/**"],
    passWithNoTests: true,
  },
});
