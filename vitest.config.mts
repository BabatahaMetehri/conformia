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

    /**
     * Le fuseau système est forcé à UTC pour que la suite soit reproductible
     * d'une machine à l'autre. `src/lib/dates.ts` ne doit dépendre d'aucun fuseau
     * système — un fuseau fixé rend une régression sur ce point visible en CI.
     *
     * Les variables applicatives sont fournies ici parce que `src/config/env.ts`
     * valide au chargement du module.
     */
    env: {
      TZ: "UTC",
      NODE_ENV: "test",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "1025",
      SMTP_USER: "test",
      SMTP_PASSWORD: "test",
      SMTP_FROM: "conformia@example.test",
      CRON_SECRET: "0123456789abcdef0123456789abcdef",
      BACKUP_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
      LOG_LEVEL: "error",
    },

    coverage: {
      provider: "v8",
      reporter: ["text-summary", "html"],
      include: ["src/lib/**/*.ts", "src/config/**/*.ts"],
      // Seuils par fichier : les deux modules dont tout le reste dépend.
      thresholds: {
        "src/lib/dates.ts": {
          statements: 90,
          branches: 90,
          functions: 90,
          lines: 90,
        },
        "src/lib/result.ts": {
          statements: 90,
          branches: 90,
          functions: 90,
          lines: 90,
        },
      },
    },
  },
});
