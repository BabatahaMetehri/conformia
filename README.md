# CONFORMIA

Plateforme interne AGROESPACE de suivi des obligations administratives, fiscales,
sociales et réglementaires périodiques.

Une **obligation** est décrite une seule fois dans un référentiel et porte ses règles.
Une **occurrence** en est une instance datée, générée automatiquement — c'est l'objet
de travail quotidien, jamais saisi à la main. Elle circule entre les états
`TODO → IN_PROGRESS → PENDING_VALIDATION → VALIDATED → SUBMITTED → ARCHIVED`, et
chaque transition est décidée par la base, pas par l'interface.

Les règles d'ingénierie du projet sont dans [CLAUDE.md](./CLAUDE.md). **Ce fichier
fait autorité** en cas de conflit.

## Démarrage

```bash
cp .env.example .env.local   # puis renseigner les valeurs
npm install
npx supabase start           # base, authentification, stockage en local
npm run db:reset             # migrations + jeu de données de développement
npm run dev
```

⚠️ **Un réglage à ne pas oublier** : `[auth.mfa.totp]` doit avoir `enroll_enabled` et
`verify_enabled` à `true` — c'est le cas dans `supabase/config.toml`, et il faut poser
le même sur le projet hébergé. Laissé à `false`, **aucun compte administrateur ne peut
entrer dans l'application** : le middleware exige un second facteur que Supabase
refuse alors de créer.

## Commandes

| Commande               | Effet                                                         |
| ---------------------- | ------------------------------------------------------------- |
| `npm run dev`          | Serveur de développement                                      |
| `npm run build`        | Build de production — doit passer sans avertissement          |
| `npm start`            | Serveur de production                                         |
| `npm run typecheck`    | `tsc --noEmit`                                                |
| `npm run lint`         | ESLint, `--max-warnings=0`                                    |
| `npm run format`       | Prettier en écriture                                          |
| `npm test`             | Vitest + couverture (seuils appliqués)                        |
| `npm run test:rls`     | Tests d'intégration contre la base réelle                     |
| `npm run test:e2e`     | Playwright — Chromium, et Firefox sur les parcours critiques  |
| `npm run db:migrate`   | Applique les migrations                                       |
| `npm run db:types`     | Régénère `src/types/database.types.ts` — **jamais à la main** |
| `npm run db:reset`     | Réinitialise la base locale + jeu de données                  |
| `npm run db:plans`     | Relève les plans d'exécution → `docs/query-plans.md`          |
| `npm run load-test`    | Épreuve de charge, 50 sessions simultanées                    |
| `npm run backup`       | Sauvegarde chiffrée                                           |
| `npm run restore`      | Restauration                                                  |
| `npm run restore:test` | Épreuve de restauration mensuelle dans une base jetable       |

Avant toute annonce de « terminé » : `typecheck`, `lint`, `test` et `test:e2e`
passent. Toute modification de schéma est suivie de `db:types` **dans le même commit**.

## Langues

Français et arabe, catalogues tenus **clé pour clé** (1416 chacun). Le choix se fait
dans le menu utilisateur ; il pose un cookie et survit donc à la navigation, aux URL
saisies à la main et aux liens reçus par courriel.

L'arabe s'affiche en RTL (`dir="rtl"` sur le document). Aucune classe Tailwind
physique n'est admise dans les sources — `ml-`, `pr-`, `text-left` figeraient une
direction : un test statique (`tests/unit/logical-properties.test.ts`) échoue si l'une
d'elles apparaît, et un test de bout en bout vérifie qu'aucun écran ne déborde
horizontalement une fois retourné.

## Documentation

| Document                                                | Répond à                                                 |
| ------------------------------------------------------- | -------------------------------------------------------- |
| [architecture.md](./docs/architecture.md)               | Pourquoi le code est disposé ainsi                       |
| [security.md](./docs/security.md)                       | Qui a le droit de quoi, et pourquoi                      |
| [data-model.md](./docs/data-model.md)                   | Ce que contient la base                                  |
| [decisions.md](./docs/decisions.md)                     | Ce qui a été décidé, ce que ça coûte                     |
| [runbook.md](./docs/runbook.md)                         | Que faire quand ça casse                                 |
| [testing.md](./docs/testing.md)                         | Ce que chaque suite garantit — et ce qu'aucune ne couvre |
| [query-plans.md](./docs/query-plans.md)                 | Ce que coûtent les requêtes _(généré)_                   |
| [backup-strategy.md](./docs/backup-strategy.md)         | Sauvegardes                                              |
| [restore-procedure.md](./docs/restore-procedure.md)     | Restauration                                             |
| [hosting-portability.md](./docs/hosting-portability.md) | Changer d'hébergeur                                      |
| [state-management.md](./docs/state-management.md)       | Où vit quel état                                         |

## Frontières de couches

`app/ → features/ → services/ → data/ → db/`, dépendances strictement descendantes.
Elles ne sont pas qu'une convention : `import/no-restricted-paths` les fait échouer au
lint, et donc au build. ESLint refuse :

- un import de `src/data/**` ou `src/lib/supabase/**` depuis `src/features/**` ou `src/components/**` ;
- un import de `src/features/**` ou de React depuis `src/services/**` ;
- un import d'une feature vers une autre feature ;
- un import de `@supabase/*` hors de `src/data/**`, `src/lib/supabase/**` et `src/server/jobs/**`.

Le hook `pre-commit` exécute `tsc --noEmit` puis `lint-staged`
(`eslint --max-warnings=0` et `prettier --check`).

## Surveillance

```bash
curl -s http://localhost:3000/api/health | jq
```

`ok`, `degraded` ou `down` (503). L'écran **Administration → Travaux planifiés** donne
le détail, et signale ce qui **n'a pas eu lieu** : une tâche arrêtée ne produit aucune
erreur, seulement du silence.
