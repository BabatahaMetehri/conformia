import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { FlatCompat } from "@eslint/eslintrc";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import importPlugin from "eslint-plugin-import";
import tseslint from "typescript-eslint";

import noAsyncTransition from "./eslint-rules/no-async-transition.mjs";
import noPhysicalCssProperties from "./eslint-rules/no-physical-css-properties.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

/**
 * Domaines fonctionnels de `src/features`. Chaque feature est une île :
 * elle ne peut pas importer une autre feature (cf. CLAUDE.md §3.1).
 */
const FEATURES = [
  "admin",
  "audit",
  "auth",
  "dashboard",
  "documents",
  "notifications",
  "obligations",
  "occurrences",
  "workflow",
];

const MSG_NO_DATA_FROM_UI =
  "Frontière de couche : la couche UI n'accède pas aux données. Passez par un service (src/services).";
const MSG_NO_FEATURES_FROM_SERVICES =
  "Frontière de couche : un service est du métier pur, il ne dépend pas de l'UI (src/features).";
const MSG_NO_CROSS_FEATURE =
  "Barrière inter-features : une feature n'importe pas une autre feature. Remontez le code partagé dans src/services, src/lib ou src/components/shared.";

const layerZones = [
  // La couche UI (composants transverses + features) ne touche jamais la donnée.
  { target: "./src/components", from: "./src/data", message: MSG_NO_DATA_FROM_UI },
  { target: "./src/components", from: "./src/lib/supabase", message: MSG_NO_DATA_FROM_UI },
  { target: "./src/features", from: "./src/data", message: MSG_NO_DATA_FROM_UI },
  { target: "./src/features", from: "./src/lib/supabase", message: MSG_NO_DATA_FROM_UI },

  // Les services sont testables sans React et sans UI.
  { target: "./src/services", from: "./src/features", message: MSG_NO_FEATURES_FROM_SERVICES },
  { target: "./src/services", from: "./src/components", message: MSG_NO_FEATURES_FROM_SERVICES },

  // Barrière inter-features : features/a ne peut pas importer features/b.
  ...FEATURES.map((feature) => ({
    target: `./src/features/${feature}`,
    from: "./src/features",
    except: [`./${feature}`],
    message: MSG_NO_CROSS_FEATURE,
  })),
];

/** Le client Supabase n'existe que dans la couche data. */
const NO_SUPABASE_OUTSIDE_DATA = {
  group: ["@supabase/*", "@supabase/**"],
  message:
    "Seuls src/data/** et src/lib/supabase/** instancient un client Supabase (cf. CLAUDE.md §3.2).",
};

/**
 * Un service ne connaît pas React — à une exception près : `cache`, qui n'est pas
 * une primitive d'interface mais de mémoïsation par requête côté serveur. Elle est
 * nommément autorisée ; hooks, JSX et le reste restent interdits.
 */
const NO_REACT_IN_SERVICES = {
  group: ["react", "react-dom", "react/*", "react-dom/*"],
  allowImportNames: ["cache"],
  message: MSG_NO_FEATURES_FROM_SERVICES,
};

/**
 * Le client Supabase n'est instancié que par la couche data. Les services
 * composent des fonctions de `src/data/**`, ils n'ouvrent pas de connexion.
 */
const NO_SUPABASE_CLIENT_OUTSIDE_DATA = {
  group: ["@/lib/supabase/*", "**/lib/supabase/*"],
  message:
    "Seule la couche src/data/** instancie un client Supabase (cf. CLAUDE.md §3.2). Passez par une fonction de src/data/queries ou src/data/mutations.",
};

/**
 * Les SDK d'envoi de courriel ne s'importent que dans leur fournisseur.
 *
 * ⚠️ C'EST CETTE RÈGLE QUI REND VRAIE LA PROMESSE « changer de fournisseur ne
 * touche aucun autre fichier ». Sans elle, la promesse tenait à la discipline :
 * il suffisait qu'un écran importe `resend` pour envoyer un message de test, et
 * la bascule vers le SMTP d'entreprise devenait un chantier. Les deux fichiers
 * `providers/resend.ts` et `providers/smtp.ts` sont exemptés nommément plus bas ;
 * pour tout le reste de `src/`, l'accès passe par l'interface `EmailProvider`.
 *
 * Les tests en sont exempts (bloc `tests/**`) : le relais local qui éprouve le
 * fournisseur Resend doit bien parler SMTP à Mailpit.
 */
const NO_EMAIL_SDK_OUTSIDE_PROVIDER = {
  /*
   * ⚠️ `regex` ET NON `group` : les motifs de groupe sont interprétés à la
   * manière d'un `.gitignore`, où un nom nu correspond à n'importe quel segment
   * de chemin — `resend` dénonçait donc `./resend`, l'import RELATIF que la
   * fabrique fait légitimement de son propre voisin. L'expression rationnelle,
   * ancrée au début, ne vise que le paquet.
   */
  regex: "^(resend|nodemailer)(/|$)",
  message:
    "Les SDK d'envoi ne s'importent que dans src/services/notifications/providers/{resend,smtp}.ts. Ailleurs, passez par l'interface EmailProvider.",
};

/**
 * Le client `service_role` contourne la RLS. Seuls les scripts de
 * `src/server/jobs/**` peuvent le charger — partout ailleurs, c'est un défaut.
 * `import 'server-only'` dans admin.ts est la seconde barrière, côté build.
 */
const NO_ADMIN_CLIENT = {
  group: ["@/lib/supabase/admin", "**/supabase/admin"],
  message:
    "Le client service_role contourne la RLS : il ne se charge que depuis src/server/jobs/**. Utilisez @/lib/supabase/server pour un accès soumis aux policies.",
};

export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      // Code DENO : autre runtime, autres globales (`Deno.serve`), imports par
      // URL. Il est exclu du programme TypeScript, donc illisible pour le
      // service de projet d'ESLint.
      "supabase/functions/**",
      "out/**",
      "build/**",
      "coverage/**",
      "next-env.d.ts",
      // Produit par `npm run db:types`. Le corriger à la main est interdit
      // (CLAUDE.md §6) : il ne peut donc pas être soumis au lint.
      "src/types/database.types.ts",
    ],
  },

  // Règles Next.js. `next/typescript` est volontairement omis : il enregistre
  // @typescript-eslint en préréglage « recommended », que strictTypeChecked remplace.
  ...compat.extends("next/core-web-vitals"),

  ...tseslint.configs.strictTypeChecked,

  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    plugins: {
      import: importPlugin,
      // Plugin local : deux règles, la contrainte RTL et la garde des transitions.
      conformia: {
        rules: {
          "no-physical-css-properties": noPhysicalCssProperties,
          "no-async-transition": noAsyncTransition,
        },
      },
    },
    settings: {
      "import/resolver-next": [
        createTypeScriptImportResolver({
          alwaysTryTypes: true,
          project: "./tsconfig.json",
        }),
      ],
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "conformia/no-physical-css-properties": "error",
      "conformia/no-async-transition": "error",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            NO_SUPABASE_OUTSIDE_DATA,
            NO_ADMIN_CLIENT,
            NO_SUPABASE_CLIENT_OUTSIDE_DATA,
            NO_EMAIL_SDK_OUTSIDE_PROVIDER,
          ],
        },
      ],
      "import/no-restricted-paths": ["error", { basePath: __dirname, zones: layerZones }],
    },
  },

  // Métier pur : ni React, ni Supabase en direct. `src/lib` et `src/config` sont
  // soumis à la même règle — ils sont importés par les jobs et les scripts.
  // ⚠️ Ce bloc précède volontairement l'exemption ci-dessous : en flat config,
  // le dernier bloc qui matche gagne, et `src/lib/**` engloberait sinon
  // `src/lib/supabase/**`, à qui l'accès à @supabase/* est justement nécessaire.
  {
    files: ["src/services/**", "src/lib/**", "src/config/**"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            NO_SUPABASE_OUTSIDE_DATA,
            NO_REACT_IN_SERVICES,
            NO_ADMIN_CLIENT,
            NO_SUPABASE_CLIENT_OUTSIDE_DATA,
            NO_EMAIL_SDK_OUTSIDE_PROVIDER,
          ],
        },
      ],
    },
  },

  /*
   * Les DEUX SEULS fichiers autorisés à connaître un SDK d'envoi. Ils gardent les
   * autres interdits : rien ici ne justifie d'ouvrir une connexion Supabase.
   */
  {
    files: [
      "src/services/notifications/providers/resend.ts",
      "src/services/notifications/providers/smtp.ts",
    ],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            NO_SUPABASE_OUTSIDE_DATA,
            NO_REACT_IN_SERVICES,
            NO_ADMIN_CLIENT,
            NO_SUPABASE_CLIENT_OUTSIDE_DATA,
          ],
        },
      ],
    },
  },

  // Seules couches autorisées à instancier un client Supabase. Le client
  // service_role leur reste interdit : il n'appartient qu'aux jobs.
  // `src/middleware.ts` figure ici à titre d'exception assumée : il rafraîchit le
  // cookie de session sur le runtime Edge, ce que la couche data — marquée
  // `server-only` — ne peut pas faire.
  {
    files: ["src/data/**", "src/lib/supabase/**", "src/middleware.ts", "tests/**"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", { patterns: [NO_ADMIN_CLIENT] }],
    },
  },

  // Scripts hors requête : seul endroit où service_role est légitime.
  {
    files: ["src/server/jobs/**"],
    rules: { "@typescript-eslint/no-restricted-imports": "off" },
  },

  // Fichiers de configuration hors périmètre TypeScript.
  {
    files: ["**/*.mjs", "**/*.js", "**/*.cjs"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
