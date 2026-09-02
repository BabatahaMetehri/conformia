# Portabilité de l'hébergement

> La question de la localisation légale des données en Algérie n'est pas
> tranchée. L'architecture doit rendre la réponse **indolore**, quelle qu'elle
> soit.

Ce document existe pour qu'une décision juridique ne se transforme pas en projet
de réécriture. Il énumère ce dont l'application dépend réellement, et ce qu'il
faut changer pour la déplacer.

---

## Ce dont l'application dépend

**Deux choses, et rien d'autre :**

| Dépendance                       | Interface employée                       | Fournisseur substituable                   |
| -------------------------------- | ---------------------------------------- | ------------------------------------------ |
| **PostgreSQL 15+**               | SQL standard, RLS, `pg_cron`, `pgcrypto` | Oui — Supabase, RDS, Cloud SQL, serveur nu |
| **Stockage objet compatible S3** | API Storage de `@supabase/supabase-js`   | Oui — MinIO, Ceph, Wasabi, S3              |

Tout le reste — Next.js, le rendu, les tâches planifiées — s'exécute sur un
serveur Node ordinaire.

### Ce qui n'est _pas_ une dépendance

- **Aucune fonction Edge de l'hébergeur.** Les tâches planifiées passent par
  `pg_cron` + `pg_net`, ou par de simples routes HTTP authentifiées
  (`/api/cron/*`) qu'un `cron` système peut appeler. Les deux chemins existent et
  sont éprouvés.
- **Aucun service propriétaire d'authentification en dehors de GoTrue**, qui est
  libre et auto-hébergeable.
- **Aucune extension PostgreSQL exclusive à un hébergeur.** `pg_cron`,
  `pgcrypto`, `pg_net` sont disponibles partout ; leur absence est _dégradante_,
  pas bloquante (les migrations le disent explicitement et proposent le repli).

---

## Basculer vers une instance auto-hébergée

### 1. Variables d'environnement à modifier

**Ce sont les seules.** Aucune ligne de code applicatif ne change.

```diff
- NEXT_PUBLIC_SUPABASE_URL="https://xxxx.supabase.co"
+ NEXT_PUBLIC_SUPABASE_URL="https://conformia.agroespace.dz"

- NEXT_PUBLIC_SUPABASE_ANON_KEY="…clé du projet hébergé…"
+ NEXT_PUBLIC_SUPABASE_ANON_KEY="…clé de l'instance locale…"

- SUPABASE_SERVICE_ROLE_KEY="…clé du projet hébergé…"
+ SUPABASE_SERVICE_ROLE_KEY="…clé de l'instance locale…"

- DATABASE_URL="postgresql://…@db.xxxx.supabase.co:5432/postgres"
+ DATABASE_URL="postgresql://…@10.0.0.12:5432/conformia"

  NEXT_PUBLIC_APP_URL="https://conformia.agroespace.dz"
```

Les variables de sauvegarde, de courriel et de cron sont indépendantes de
l'hébergeur et ne bougent pas.

### 2. Réglages en base, pas en code

Deux paramètres pointent vers les routes de tâches planifiées et se règlent en
SQL :

```sql
alter database conformia set "app.generate_occurrences_url" =
  'https://conformia.agroespace.dz/api/cron/generate';
alter database conformia set "app.notifications_url" =
  'https://conformia.agroespace.dz/api/cron/notifications';
alter database conformia set "app.backup_url" =
  'https://conformia.agroespace.dz/api/cron/backup';
alter database conformia set "app.restore_test_url" =
  'https://conformia.agroespace.dz/api/cron/restore-test';
```

Le fournisseur de courriel se change **sans redéploiement**, par une écriture :

```sql
update public.app_settings set email_provider = 'smtp';
```

### 3. Migration des données

```bash
# 1. Export depuis l'instance actuelle
npm run backup -- --kind=MANUAL

# 2. Restauration sur la nouvelle
npm run restore -- --archive=… --target=postgresql://…/conformia_restore --storage=/srv/storage

# 3. Contrôles (docs/restore-procedure.md, étapes 4 et 5), puis bascule du DNS
```

### 4. Ce qu'il faut prévoir côté infrastructure

| Composant      | Auto-hébergé                                    |
| -------------- | ----------------------------------------------- |
| PostgreSQL     | 15+, extensions `pgcrypto`, `pg_cron`, `pg_net` |
| Stockage objet | MinIO ou équivalent S3, bucket **privé**        |
| GoTrue         | Conteneur officiel `supabase/gotrue`            |
| PostgREST      | Conteneur officiel `postgrest/postgrest`        |
| Storage API    | Conteneur officiel `supabase/storage-api`       |
| Application    | Node 22+, `npm run build && npm run start`      |
| TLS            | Terminaison au reverse proxy                    |

L'ensemble tient dans le `docker-compose` de référence de Supabase, sur une
machine unique. Le dimensionnement est modeste : le volume annuel d'AGROESPACE se
compte en centaines de dossiers, pas en millions.

---

## Ce qui ne se transporte pas tel quel

Honnêteté sur les points de friction. Aucun n'est bloquant ; tous demandent une
demi-journée.

1. **Le PITR (niveau 1 des sauvegardes)** est un service de l'hébergeur.
   Auto-hébergé, il faut le reconstituer avec `wal-g` ou `pgBackRest`. La
   sauvegarde de niveau 2, elle, fonctionne à l'identique — c'est précisément
   pourquoi elle existe.

2. **Les jetons JWT changent de secret.** Toutes les sessions sont invalidées à
   la bascule : les utilisateurs se reconnectent. À annoncer, pas à découvrir.

3. **Les liens de flux calendrier (ICS) contiennent le domaine.** Après bascule,
   chaque abonné doit se réabonner — l'ancien lien pointe vers un hôte qui ne
   répond plus. L'écran `/profile/calendar` porte déjà l'instruction.

4. **`pg_net` n'est pas installé partout.** Sans lui, les migrations basculent sur
   un `raise notice` et les tâches doivent être appelées par un `cron` système
   sur les routes `/api/cron/*`, avec `CRON_SECRET`. Le chemin est éprouvé par le
   test `e2e/cron-generation.spec.ts`.

---

## Vérifier la portabilité, plutôt que l'affirmer

L'application tourne déjà sur **deux hébergements différents** dans son cycle de
développement :

- la pile Supabase locale (`supabase start`), qui est l'auto-hébergement en
  miniature — mêmes conteneurs, mêmes versions ;
- l'environnement de développement de chacun.

L'intégralité de la suite d'intégration et des tests de bout en bout s'exécute
contre la pile **locale**. Autrement dit : le mode auto-hébergé n'est pas une
hypothèse documentée, c'est le mode dans lequel le projet est testé tous les
jours.

---

## Décision à prendre par la direction

La bascule est une opération d'une journée, dont la moitié est du contrôle. Ce
qui doit être arbitré n'est pas technique :

- [ ] Les données doivent-elles résider sur le territoire algérien ?
- [ ] Si oui, sur une infrastructure d'AGROESPACE ou chez un hébergeur local ?
- [ ] Qui exploite PostgreSQL au quotidien — mises à jour, supervision,
      sauvegardes de niveau 1 ?

La troisième question est la vraie. L'hébergement managé achète de
l'exploitation, pas de la technique.
