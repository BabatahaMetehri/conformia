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

      /*
       * ⚠️ ENVOI DE COURRIEL : les deux fournisseurs pointent sur Mailpit.
       *
       * `SMTP_*` vise la boîte locale de Supabase (54325 par défaut, l'interface
       * web étant sur 54324). `RESEND_API_KEY` n'a pas besoin d'être une vraie
       * clé : le SDK exige seulement qu'elle existe, et `RESEND_BASE_URL` — posé
       * à l'exécution par le scénario, sur un port éphémère — le détourne vers un
       * relais local qui remet le message à ce même Mailpit.
       *
       * Les valeurs de `.env.local` l'emportent : sur un poste où les ports ont
       * été décalés, la configuration du développeur reste la bonne.
       */
      SMTP_HOST: process.env["SMTP_HOST"] ?? "127.0.0.1",
      SMTP_PORT: process.env["SMTP_PORT"] ?? "54325",
      SMTP_USER: process.env["SMTP_USER"] ?? "dev",
      SMTP_PASSWORD: process.env["SMTP_PASSWORD"] ?? "dev",
      SMTP_FROM: process.env["SMTP_FROM"] ?? "conformia@example.test",
      RESEND_API_KEY: process.env["RESEND_API_KEY"] ?? "re_test_relais_local",
    },

    /*
     * ⚠️ COUVERTURE MESURÉE ICI, ET NON DANS LA SUITE UNITAIRE. Les deux
     * fournisseurs d'envoi ne se couvrent pas à coups de doublures : leur seul
     * comportement intéressant est ce qu'ils font d'un vrai serveur — celui qui
     * accepte, celui qui refuse, celui qui ne répond pas. `tests/integration/
     * notification-delivery.test.ts` les exerce contre Mailpit ; c'est donc ici
     * que le chiffre a un sens.
     *
     * N'entre en vigueur qu'avec `--coverage` : `npm run test:integration:coverage`.
     */
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "html"],
      include: [
        "src/services/notifications/providers/resend.ts",
        "src/services/notifications/providers/smtp.ts",
      ],
      thresholds: {
        /*
         * 90 % sur chacun. Le reste — la fabrique et les canaux dormants — est
         * volontairement hors périmètre : la première a une branche qui dépend
         * d'une variable d'environnement figée au chargement du module, les
         * seconds sont couverts par la suite unitaire, où ils sont à leur place.
         */
        "src/services/notifications/providers/resend.ts": {
          statements: 90,
          branches: 90,
          functions: 90,
          lines: 90,
        },
        "src/services/notifications/providers/smtp.ts": {
          statements: 90,
          branches: 80,
          functions: 90,
          lines: 90,
        },
      },
    },
  },
});
