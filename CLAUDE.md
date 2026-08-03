# CONFORMIA — Instructions projet

Plateforme interne AGROESPACE (agro-industrie, Algérie) de suivi des obligations
administratives, fiscales, sociales et réglementaires périodiques.

Ce fichier fait autorité. En cas de conflit avec une habitude, une convention externe
ou une suggestion d'outil, ce fichier gagne.

---

## 1. Contexte métier

**Domaine** : conformité réglementaire d'entreprise.

**Obligation** — décrite **une seule fois** dans un référentiel (ex. déclaration G50).
Porte ses règles : périodicité, mode de calcul d'échéance, pièces requises, entité
responsable, base légale.

**Occurrence** — instance datée générée **automatiquement** à partir d'une obligation
(ex. « G50 de janvier 2026 »). C'est l'objet de travail quotidien. Une occurrence n'est
jamais saisie à la main dans le flux nominal.

**Cycle de vie d'une occurrence** :

```
TODO → IN_PROGRESS → PENDING_VALIDATION → VALIDATED → SUBMITTED → ARCHIVED
```

Transitions annexes :

- `REJECTED` — depuis `PENDING_VALIDATION`, retour vers `IN_PROGRESS` après correction.
- `NOT_APPLICABLE` — l'occurrence est générée mais sans objet sur la période.

Les transitions autorisées sont **des données**, pas un `switch`. Toute transition passe
par le service de machine à états, qui vérifie : transition permise, rôle de l'acteur,
pièces requises présentes.

**Documents rattachés** : hautement sensibles (déclarations fiscales, données sociales,
correspondance administrative). Ordre de priorité non négociable :

1. Confidentialité (RLS + Storage privé, aucune URL publique, URLs signées à durée courte).
2. Traçabilité intégrale (qui, quoi, quand, ancien état → nouvel état).
3. Intégrité (hash au dépôt, versionnement, jamais d'écrasement en place).
4. Confort d'usage — **après** les trois précédents, jamais avant.

---

## 2. Stack technique imposée

| Domaine               | Choix                                          | Contrainte                                                             |
| --------------------- | ---------------------------------------------- | ---------------------------------------------------------------------- |
| Framework             | Next.js 15, App Router                         | Server Components par défaut ; `"use client"` justifié                 |
| UI runtime            | React 19                                       | Server Actions pour les mutations                                      |
| Langage               | TypeScript `strict`                            | Aucun `any`, aucun `as` non justifié                                   |
| Base / Auth / Storage | Supabase (Postgres)                            | **RLS activée sur toutes les tables**, sans exception                  |
| Accès données         | `@supabase/ssr`                                | Types générés par `supabase gen types typescript`                      |
| Validation            | Zod                                            | Schéma unique partagé serveur/client par entité                        |
| Formulaires           | `react-hook-form` + `@hookform/resolvers`      | Résolveur Zod obligatoire                                              |
| État serveur (client) | TanStack Query                                 | Clés de cache typées et centralisées par feature                       |
| État UI éphémère      | Zustand                                        | Usage minimal ; jamais de données serveur dans un store                |
| Style                 | Tailwind CSS v4                                | Configuration CSS-first (`@theme`), pas de `tailwind.config.js` étendu |
| Composants            | shadcn/ui + `lucide-react`                     | Primitives dans `src/components/ui`, zéro métier dedans                |
| Tableaux              | TanStack Table                                 | Tri/filtre/pagination côté serveur pour les listes d'occurrences       |
| Dates                 | `date-fns` + `date-fns-tz`                     | Fuseau **`Africa/Algiers`** (UTC+1, pas de DST)                        |
| i18n                  | `next-intl`                                    | Locale par défaut `fr` ; architecture prête pour `ar` en RTL           |
| Tests                 | Vitest + `@testing-library/react` + Playwright | Services et calculs d'échéance testés en priorité                      |

**Stockage des dates** : `timestamptz` en base, toujours en UTC. La conversion vers
`Africa/Algiers` se fait à la frontière (affichage, calcul d'échéance, bornes de période).
Une échéance « au 20 du mois » signifie fin de journée à Alger, pas à UTC.

---

## 3. Principes d'architecture non négociables

### 3.1 Couches, dépendances strictement descendantes

```
app/       routage, RSC, layouts, chargement des messages i18n
  ↓
features/  UI métier (composants, hooks, schémas de formulaire)
  ↓
services/  logique métier, règles, orchestration, audit
  ↓
data/      accès Supabase, requêtes, mapping ligne → modèle
  ↓
db/        SQL : tables, RLS, fonctions, triggers, migrations
```

- Aucune dépendance **ascendante** : `services/` ne connaît pas React ; `data/` ne connaît
  pas les services.
- Aucune dépendance **latérale entre features** : `features/documents` n'importe rien de
  `features/occurrences`. Le partage passe par la couche du dessous ou par `core/`.
- `core/` et `lib/` sont importables par toutes les couches ; ils n'importent aucune couche.

### 3.2 Aucun composant n'importe le client Supabase

Un composant appelle un service (Server Component ou Server Action). Le seul module
autorisé à instancier un client Supabase est `src/data/supabase/*`. Un `import` de
`@supabase/*` hors de `src/data/` ou `src/server/jobs/` est un défaut à corriger, pas à discuter.

### 3.3 Les services retournent `Result<T, AppError>`

Jamais d'exception métier. Les exceptions sont réservées aux bugs de programmation.

```ts
type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E };

type AppError = {
  code: AppErrorCode; // union littérale, jamais string
  messageKey: string; // clé i18n, jamais un message rédigé
  details?: Record<string, unknown>;
  cause?: unknown; // conservé pour le log serveur, jamais renvoyé au client
};
```

L'appelant traite explicitement les deux branches. Pas de `result.value!`.

### 3.4 DRY sur le métier, pas sur l'UI

Une règle métier existe à un seul endroit. Deux composants visuellement proches mais
porteurs de métiers distincts (ex. tableau des occurrences vs tableau des documents)
**restent séparés**. Une abstraction UI prématurée coûte plus cher que la duplication.

### 3.5 Les règles réglementaires sont des DONNÉES

Périodicité, calcul d'échéance, pièces requises, seuils, entités responsables : **en base**.

Interdit, partout, sans exception :

```ts
if (obligation.code === 'G50') { ... }   // ❌ jamais
```

Ajouter une nouvelle obligation ne doit demander **aucun déploiement de code** — seulement
une ligne de référentiel. Si une règle nouvelle ne s'exprime pas avec le modèle en place,
on étend le **modèle de données**, pas le code par cas particulier.

### 3.6 Toute écriture produit un audit

Toute écriture sur une entité métier (obligation, occurrence, document, affectation,
transition d'état) produit une entrée d'audit. Sans exception, y compris les scripts de
`src/server/jobs/` et la génération automatique d'occurrences.

L'audit enregistre : acteur, action, entité, identifiant, état avant, état après, horodatage
UTC, origine (UI / job / migration). Il est **append-only** : aucun `UPDATE`, aucun `DELETE`.
La garantie repose sur des triggers Postgres, pas sur la discipline de l'appelant.

---

## 4. Structure de dossiers cible

```
conformia/
├─ CLAUDE.md
├─ next.config.ts
├─ tsconfig.json                    # strict, paths "@/*" → src/*
├─ vitest.config.ts
├─ playwright.config.ts
├─ components.json                  # shadcn/ui
├─ messages/                        # source unique des textes visibles
│  ├─ fr.json                       # locale par défaut
│  └─ ar.json                       # RTL, tenue à jour dès la création d'une clé
├─ supabase/                        # ← couche db/ (SQL versionné)
│  ├─ config.toml
│  ├─ migrations/                   # horodatées, immuables une fois appliquées
│  ├─ functions/                    # fonctions SQL, triggers d'audit
│  ├─ policies/                     # policies RLS, une par table, nommées
│  └─ seed.sql                      # référentiel d'obligations de développement
├─ e2e/                             # specs Playwright
└─ src/
   ├─ app/
   │  ├─ [locale]/
   │  │  ├─ layout.tsx              # NextIntlClientProvider, dir=ltr|rtl
   │  │  ├─ (auth)/                 # login, mot de passe oublié
   │  │  └─ (app)/                  # zone authentifiée
   │  │     ├─ layout.tsx
   │  │     ├─ dashboard/
   │  │     ├─ obligations/         # référentiel
   │  │     ├─ occurrences/         # écran de travail principal
   │  │     ├─ documents/
   │  │     ├─ audit/               # consultation seule
   │  │     └─ admin/               # utilisateurs, rôles, entités
   │  ├─ api/                       # webhooks / route handlers uniquement
   │  └─ global-error.tsx
   ├─ features/                     # UI métier, cloisonnée par domaine
   │  ├─ obligations/{components,hooks,schemas,actions}/
   │  ├─ occurrences/
   │  ├─ documents/
   │  ├─ audit/
   │  ├─ notifications/
   │  └─ auth/
   ├─ services/                     # logique métier, retourne Result<T, AppError>
   │  ├─ obligations/
   │  ├─ occurrences/               # génération, machine à états, affectation
   │  ├─ scheduling/                # calcul d'échéance à partir des règles en base
   │  ├─ documents/                 # dépôt, hash, versionnement, URLs signées
   │  ├─ audit/
   │  └─ auth/                      # session, rôles, autorisations
   ├─ data/                         # seul point d'accès Supabase
   │  ├─ supabase/
   │  │  ├─ server.ts               # client RSC / Server Action (cookies)
   │  │  ├─ browser.ts              # client navigateur (anon key)
   │  │  └─ middleware.ts           # rafraîchissement de session
   │  ├─ repositories/              # une fonction = une requête, colonnes explicites
   │  └─ types/database.types.ts    # GÉNÉRÉ — ne jamais éditer à la main
   ├─ core/                         # Result, AppError, enums métier, constantes
   ├─ lib/                          # utilitaires purs (dates/tz, hash, formatage)
   ├─ components/ui/                # primitives shadcn, aucun métier
   ├─ i18n/                         # routing, request config next-intl
   ├─ server/
   │  └─ jobs/                      # SEUL emplacement autorisé pour service_role
   └─ middleware.ts
```

Convention de nommage : fichiers en `kebab-case`, composants React en `PascalCase`,
un fichier `index.ts` par feature exposant sa surface publique — l'import d'un chemin
interne d'une autre feature est interdit.

---

## 5. Commandes

| Commande             | Effet                                                     |
| -------------------- | --------------------------------------------------------- |
| `npm run dev`        | serveur de développement Next.js                          |
| `npm run build`      | build de production (doit passer sans warning TypeScript) |
| `npm run typecheck`  | `tsc --noEmit`                                            |
| `npm run lint`       | ESLint                                                    |
| `npm run test`       | Vitest (unitaires + composants)                           |
| `npm run test:e2e`   | Playwright                                                |
| `npm run db:migrate` | applique les migrations Supabase                          |
| `npm run db:types`   | régénère `src/data/types/database.types.ts`               |
| `npm run db:reset`   | réinitialise la base locale + seed — **local uniquement** |

Avant toute annonce de « terminé » : `typecheck`, `lint` et `test` passent. Toute
modification de schéma est suivie de `db:types` dans le même commit.

---

## 6. Interdits explicites

- ❌ `any`, `@ts-ignore`, `@ts-expect-error` sans commentaire justifiant la ligne.
- ❌ `eslint-disable` sans commentaire justifiant la règle désactivée et sa portée.
- ❌ `SELECT *` dans le code applicatif — colonnes explicites, toujours.
- ❌ Clé `service_role` hors de `src/server/jobs/`. Jamais dans un composant, un service,
  une Server Action, une route handler, ni dans une variable préfixée `NEXT_PUBLIC_`.
- ❌ Suppression physique de données métier — `deleted_at` uniquement, filtré au niveau RLS.
- ❌ Logique de date sans passage explicite par `Africa/Algiers`. Interdits directs :
  `new Date()` pour une date métier, `toLocaleDateString`, arithmétique sur des timestamps bruts.
- ❌ Chaîne visible par l'utilisateur écrite en dur dans un composant — tout passe par
  `next-intl` et `messages/`. Inclut : libellés, messages d'erreur, tooltips, `aria-label`,
  états vides, textes de confirmation.
- ❌ Table sans RLS, ou policy `USING (true)` pour contourner.
- ❌ Écriture métier sans entrée d'audit correspondante.
- ❌ Branchement sur un code d'obligation en dur (cf. §3.5).
- ❌ URL publique ou non signée vers un document.
- ❌ Édition manuelle de `database.types.ts` ou d'une migration déjà appliquée.

---

## 7. Comportement attendu de l'agent

- Lire ce fichier avant toute modification. En cas de doute sur une règle métier,
  demander — ne pas inventer une règle réglementaire algérienne.
- Une nouvelle table ⇒ migration + policies RLS + trigger d'audit, dans le même commit.
- Une nouvelle clé i18n ⇒ ajoutée dans `fr.json` **et** `ar.json`.
- Ne pas installer de dépendance hors de la stack du §2 sans validation explicite.
- Ne jamais désactiver une contrainte (RLS, `strict`, règle ESLint) pour faire passer
  un test ou un build. Corriger la cause.
