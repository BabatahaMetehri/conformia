import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Suite d'intégration : exige un PostgreSQL Supabase local en marche.
 *
 * Configuration séparée, et volontairement absente de `npm test` : le hook
 * pre-commit ne doit pas exiger Docker sur le poste de chaque développeur.
 * Lancement : `npm run test:rls`.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // Les politiques se testent en séquence : les scénarios partagent un jeu
    // d'essai et se marcheraient dessus en parallèle.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      TZ: "UTC",
    },
  },
});
