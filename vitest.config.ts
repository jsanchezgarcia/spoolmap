import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "worker/**/*.test.{ts,js}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "worker/src/**/*.js"],
      exclude: ["src/**/*.test.ts", "src/test/**", "worker/**/*.test.{ts,js}"],
      reporter: ["text", "json-summary", "html"],
      // These gates are the integer floors of the all-source Node 22 baseline.
      // Keeping a small runtime margin avoids false failures while ensuring
      // newly added, untested modules lower coverage instead of disappearing.
      thresholds: {
        statements: 47,
        branches: 40,
        functions: 53,
        lines: 49,
      },
    },
  },
})
