# generate-occurrences

Déclenchement quotidien de la génération des occurrences.

## Rôle exact

Cette fonction **ne calcule aucune échéance**. Elle appelle
`POST /api/cron/generate` sur l'application, qui détient le moteur.

La raison est la même que partout ailleurs dans ce projet : il n'existe qu'une
implémentation du calcul d'échéance (`src/services/scheduling/due-dates.ts`).
Une seconde, fût-elle « juste pour la tâche de nuit », finirait par diverger — et
le jour où elle diverge, les dates générées cessent d'être celles que l'écran a
annoncées.

## Planification

`pg_cron` déclenche à **01 h 00 UTC**, soit **02 h 00 à Alger**.

⚠️ L'Algérie est à UTC+1 **toute l'année**, sans heure d'été depuis 1981. La
conversion est donc fixe. Écrire `0 2 * * *` ferait tourner la tâche à 03 h 00
locales — sans conséquence visible, ce qui est précisément ce qui rend l'erreur
durable.

La planification est posée par la migration `0013_generation_engine.sql`.

## Secrets

| Nom           | Rôle                                               |
| ------------- | -------------------------------------------------- |
| `APP_URL`     | Racine de l'application, sans barre oblique finale |
| `CRON_SECRET` | Doit être IDENTIQUE à celui de l'application       |

```bash
supabase secrets set APP_URL="https://conformia.example.dz"
supabase secrets set CRON_SECRET="…"
supabase functions deploy generate-occurrences --no-verify-jwt
```

`--no-verify-jwt` parce que l'appelant est `pg_cron`, qui n'a pas de session
utilisateur. L'authentification repose entièrement sur `CRON_SECRET`, comparé en
temps constant par la route applicative.

## Si pg_cron ou pg_net sont indisponibles

La migration le signale par un `notice` et n'échoue pas. Il faut alors appeler
`POST /api/cron/generate` depuis un ordonnanceur externe, avec l'en-tête
`x-cron-secret`. Le verrou consultatif reste la garantie contre les exécutions
concurrentes, quel que soit le déclencheur.
