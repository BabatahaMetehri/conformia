import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    // Playwright pilote tests/e2e : Vitest n'y touche pas.
    exclude: ["node_modules/**", ".next/**", "tests/e2e/**"],
    restoreMocks: true,
  },
});
