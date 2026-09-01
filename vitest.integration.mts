import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Suite d'intégration : exige un PostgreSQL Supabase local en marche.
 *
 * Configuration séparée, et volontairement absente de `npm test` : le hook
 * pre-commit ne doit pas exiger Docker sur le poste de chaque développeur.
 * Lancement : `npm run test:rls`.
 */
/**
 * Charge `.env.local`.
 *
 * ⚠️ Sans cela, `SUPABASE_SERVICE_ROLE_KEY` est absent du processus de test et
 * les scénarios qui touchent au VRAI stockage échouent sur un message obscur —
 * ou pire, se contentent de sauter. La suite affiche alors un vert trompeur :
 * elle n'a rien vérifié. Next charge ce fichier pour l'application, jamais pour
 * le lanceur de tests — c'est à lui de le faire.
 *
 * Les valeurs déjà présentes dans l'environnement l'emportent : en CI, les
 * secrets viennent du coffre, pas d'un fichier absent du dépôt.
 *
 * ⚠️ Recopié de `playwright.config.ts` plutôt que partagé : celui-ci est
 * transpilé en CommonJS par Playwright, et un module `.mts` commun n'y serait
 * pas importable. Vingt lignes en double coûtent moins qu'un chargement de
 * configuration qui casse selon le lanceur.
 */
function loadEnvLocal(): void {
  let raw: string;
  try {
    raw = readFileSync(new URL("./.env.local", import.meta.url), "utf8");
  } catch {
    return;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, "");

    process.env[key] ??= value;
  }
}

loadEnvLocal();

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      /*
       * ⚠️ `server-only` lève à l'import hors composant serveur. La suite
       * d'intégration éprouve les services en Node, hors de tout rendu React :
       * elle doit pouvoir les importer. Le remplaçant est CANTONNÉ à ce
       * lanceur — la garantie de production reste le build Next.js, qui échoue
       * si un module `server-only` atteint un bundle client.
       */
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
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
      NEXT_PUBLIC_SUPABASE_URL: process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "",
      SUPABASE_SERVICE_ROLE_KEY: process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "",
    },
  },
});
