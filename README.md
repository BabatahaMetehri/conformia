# CONFORMIA

Plateforme interne AGROESPACE de suivi des obligations administratives, fiscales,
sociales et réglementaires périodiques.

Les règles d'ingénierie du projet (contexte métier, architecture en couches,
interdits) sont dans [CLAUDE.md](./CLAUDE.md). Ce fichier fait autorité.

## Démarrage

```bash
cp .env.example .env.local   # puis renseigner les valeurs
npm install
npm run dev
```

## Commandes

| Commande             | Effet                                                |
| -------------------- | ---------------------------------------------------- |
| `npm run dev`        | Serveur de développement                             |
| `npm run build`      | Build de production                                  |
| `npm start`          | Serveur de production                                |
| `npm run typecheck`  | `tsc --noEmit`                                       |
| `npm run lint`       | ESLint, `--max-warnings=0`                           |
| `npm run lint:fix`   | ESLint avec correction automatique                   |
| `npm run format`     | Prettier en écriture                                 |
| `npm test`           | Vitest, une passe                                    |
| `npm run test:watch` | Vitest en continu                                    |
| `npm run test:e2e`   | Playwright _(à installer)_                           |
| `npm run db:migrate` | Applique les migrations _(CLI Supabase à installer)_ |
| `npm run db:types`   | Régénère `src/types/database.types.ts`               |
| `npm run db:reset`   | Réinitialise la base locale                          |
| `npm run db:seed`    | Applique les jeux de données de `supabase/seed/`     |

## Frontières de couches

`app/ → features/ → services/ → data/ → db/`, dépendances strictement descendantes.
Elles ne sont pas qu'une convention : `import/no-restricted-paths` les fait échouer
au lint. Concrètement, ESLint refuse :

- un import de `src/data/**` ou `src/lib/supabase/**` depuis `src/features/**` ou `src/components/**` ;
- un import de `src/features/**` ou de React depuis `src/services/**` ;
- un import d'une feature vers une autre feature ;
- un import de `@supabase/*` hors de `src/data/**`, `src/lib/supabase/**` et `src/server/jobs/**`.

Le hook `pre-commit` exécute `tsc --noEmit` puis `lint-staged`
(`eslint --max-warnings=0` et `prettier --check`).
