import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      /*
       * ⚠️ `server-only` lève à l'import hors composant serveur. Plusieurs
       * modules éprouvés ici — planificateur, diffuseur, résumé — le déclarent à
       * juste titre, et leurs fonctions PURES resteraient sans test sans ce
       * remplaçant. Il est CANTONNÉ au lanceur : la garantie de production reste
       * le build Next.js, qui échoue si un module `server-only` atteint un
       * bundle client. Même choix, même raison, que dans vitest.integration.mts.
       */
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  /*
   * ⚠️ Transformation JSX AUTOMATIQUE, imposée ici. Le `tsconfig.json` du projet déclare
   * `jsx: "preserve"` — c'est ce qu'attend Next.js, qui transforme le JSX
   * lui-même — et Vite reprend ce réglage tel quel : il laisse alors passer du
   * JSX brut, que l'analyseur d'imports refuse. Les gabarits de courriel sont
   * des composants React ; sans cette ligne, tout module qui les importe, même
   * indirectement, casse au chargement du test.
   */
  oxc: { jsx: { runtime: "automatic", importSource: "react" } },
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
      include: ["src/lib/**/*.ts", "src/config/**/*.ts", "src/services/scheduling/**/*.ts"],
      // Seuils par fichier : les deux modules dont tout le reste dépend.
      thresholds: {
        /*
         * ⚠️ 100 % DE BRANCHES sur le calcul d'échéance. Ce n'est pas un chiffre
         * décoratif : une branche non couverte ici est un cas de calendrier que
         * personne n'a éprouvé, et une échéance fausse produit un dépôt en
         * retard, donc une pénalité réelle. C'est le seul module du projet à
         * porter ce seuil.
         */
        "src/services/scheduling/due-dates.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
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
