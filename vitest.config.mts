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

      /*
       * ⚠️ CE QUE CETTE LISTE COUVRE, ET CE QU'ELLE NE COUVRE PAS.
       *
       * Elle réunit les modules PURS : calcul, validation, formatage, machine à
       * états. Ce sont ceux dont un test unitaire mesure réellement le
       * comportement, et ceux dont une régression ne se verrait nulle part
       * ailleurs avant la production.
       *
       * Les services qui ORCHESTRENT la base (dépôt, export, notification,
       * tableau de bord) en sont volontairement absents. Les couvrir ici
       * supposerait de simuler le client Supabase : le test mesurerait alors la
       * simulation, pas la règle — et la règle, ici, vit dans la RLS et dans les
       * fonctions SQL. Ces modules sont éprouvés par `vitest.integration.mts`
       * (base réelle) et par la suite Playwright (application réelle), dont la
       * couverture ne se lit pas dans ce rapport. Voir `docs/testing.md`.
       */
      include: [
        "src/lib/**/*.ts",
        "src/config/**/*.ts",
        "src/services/scheduling/**/*.ts",
        "src/services/workflow/state-machine.ts",
        "src/services/occurrences/completeness.ts",
        /*
         * ⚠️ LES GABARITS DE COURRIEL Y FIGURENT, bien qu'ils rendent du JSX.
         * Ce ne sont pas des écrans : ils n'ont ni état, ni interaction, ni accès
         * aux données — une charge utile entre, deux chaînes sortent. C'est donc
         * bien du calcul pur, et une régression y est invisible partout ailleurs :
         * un gabarit qui casse ne fait échouer ni la compilation ni le build, il
         * lève à l'exécution dans une tâche horaire, et l'échéance passe.
         */
        "src/emails/**/*.{ts,tsx}",
        // Canaux déclarés et dormants : un refus, rien d'autre à orchestrer.
        "src/services/notifications/providers/dormant-channels.ts",
      ],
      exclude: [
        // Fabriques de clients : trois lignes de configuration, rien à éprouver.
        "src/lib/supabase/client.ts",
        "src/lib/supabase/server.ts",
        "src/lib/supabase/admin.ts",
        "src/lib/supabase/middleware.ts",
        // Clés de cache et utilitaires de transport, sans logique décisionnelle.
        "src/lib/query-keys.ts",
        "src/lib/upload-transport.ts",
        "src/lib/utils.ts",
        // Le générateur est un job : sa vérification est `tests/integration/generation.test.ts`.
        "src/services/scheduling/generator.ts",
      ],

      thresholds: {
        /*
         * ⚠️ 100 % sur le calcul d'échéance. Ce n'est pas un chiffre décoratif :
         * une branche non couverte ici est un cas de calendrier que personne n'a
         * éprouvé, et une échéance fausse produit un dépôt en retard, donc une
         * pénalité réelle.
         */
        "src/services/scheduling/due-dates.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        /*
         * ⚠️ 100 % sur la TRADUCTION des verdicts de transition. Chaque code de
         * refus rendu par `evaluate_transition()` doit devenir l'erreur juste :
         * un manque de permission présenté comme une pièce manquante envoie
         * l'utilisateur chercher un document qui n'existe pas. La matrice des
         * transitions elle-même est éprouvée en base, pas ici.
         */
        "src/services/workflow/state-machine.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        /*
         * Les trois modules dont TOUT le reste dépend : le fuseau d'Alger, le
         * type Result, la hiérarchie d'erreurs. Une régression ici se propage
         * partout à la fois.
         */
        "src/lib/dates.ts": { statements: 95, branches: 95, functions: 95, lines: 95 },
        "src/lib/result.ts": { statements: 95, branches: 95, functions: 95, lines: 95 },
        "src/lib/errors.ts": { statements: 95, branches: 95, functions: 95, lines: 95 },
        // Validation des règles d'échéance : le portier du référentiel.
        "src/services/scheduling/due-rule.ts": {
          statements: 95,
          branches: 95,
          functions: 95,
          lines: 95,
        },
        // Complétude d'un dossier : décide ce que l'écran déclare manquant.
        "src/services/occurrences/completeness.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },

        /*
         * ⚠️ 90 % SUR LES GABARITS DE COURRIEL. Le seuil garde deux choses que
         * rien d'autre ne garde : que CHAQUE gabarit soit rendu au moins une
         * fois — sans quoi il ne se casse qu'en production — et que les
         * variantes où une donnée MANQUE le soient aussi. Ce sont elles qui
         * produisent les « null » et les blocs vides, et elles n'apparaissent
         * jamais dans le jeu de données complet qu'on emploie pour relire.
         *
         * Une branche reste découverte, et c'est assumé : la coquille sait se
         * rendre SANS lien d'action, alors qu'aucun gabarit n'en omet. La
         * défense est légitime, l'atteindre demanderait un gabarit fictif.
         */
        "src/emails/**": { statements: 95, branches: 90, functions: 95, lines: 95 },

        /*
         * Plancher GLOBAL sur l'ensemble ci-dessus. Il ne récompense rien : il
         * empêche qu'un module pur arrive sans test et fasse glisser le total
         * sans que personne ne le remarque.
         */
        statements: 92,
        branches: 85,
        functions: 90,
        lines: 92,
      },
    },
  },
});
