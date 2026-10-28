import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      enabled: false,
      provider: "v8",
    },
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
