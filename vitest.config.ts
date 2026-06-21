import { defineConfig } from "vitest/config";

// Vitest runs the pure recommendation/matching logic in a plain Node env.
// resolve.tsconfigPaths resolves the `@/` alias from tsconfig.json natively
// (vitest 4+), so tests import the same way the app code does.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
