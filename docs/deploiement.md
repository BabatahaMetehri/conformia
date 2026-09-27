# Mise en production — du poste de travail à l'équipe

Ce document conduit CONFORMIA de la machine de développement à une installation
que l'équipe ouvre depuis un navigateur. Il suppose qu'aucune décision
d'hébergement n'a encore été prise.

`docs/go-live.md` dit **ce qu'il faut avoir réglé** avant d'ouvrir à l'équipe
(secrets, données réelles, sauvegardes, pilote). Ce fichier-ci dit **comment on
installe**. Les deux se lisent, dans cet ordre.

---

## Ce qu'on déploie — deux pièces, pas une

| Pièce             | Ce que c'est                                                 | Où elle va                           |
| ----------------- | ------------------------------------------------------------ | ------------------------------------ |
| **La base**       | Postgres, l'authentification, le stockage des pièces jointes | Un projet Supabase hébergé           |
| **L'application** | Le site Next.js que l'équipe ouvre                           | Vercel, ou un serveur que vous tenez |

⚠️ **Docker ne sert qu'en développement.** `supabase start` fabrique une copie
locale, jetable, sur votre machine. Elle n'est accessible qu'à vous et disparaît
quand l'ordinateur s'éteint. Rien de ce qui suit ne l'utilise.

### Le choix d'hébergement, en une phrase

**Supabase hébergé + Vercel.** C'est la combinaison pour laquelle l'application
est écrite, celle où les migrations et les tâches planifiées fonctionnent sans
adaptation, et celle qui ne demande à personne d'administrer un serveur Linux.

Un serveur autogéré reste possible — la section **Variante VPS** en donne les
étapes. Il se justifie si les données doivent rester sur une machine en Algérie.
Il coûte alors ce que coûte un serveur : quelqu'un pour le tenir à jour.

---

## Avant de commencer

```bash
npm install -g supabase   # si la CLI n'est pas déjà là
supabase --version        # 2.x attendu
git status                # doit être propre
npm test && npm run build # doivent passer avant de déployer quoi que ce soit
```

Préparez aussi :

- un compte **Supabase** (supabase.com) ;
- un compte **Vercel** (vercel.com), connecté au dépôt Git ;
- un compte **Resend** (resend.com) pour l'envoi des courriels ;
- le **nom de domaine** que l'équipe tapera, si vous en voulez un.

---

## Étape 1 · Le projet Supabase

1. **Créer le projet.** supabase.com → _New project_.
   - **Nom** : `conformia-production`.
   - **Région** : `eu-central-1` (Francfort) ou `eu-west-3` (Paris) — les plus
     proches de l'Algérie. La région ne se change plus après coup.
   - **Mot de passe de la base** : généré, long. ⚠️ Il n'est affiché
     **qu'une fois**. Rangez-le dans le coffre de l'entreprise immédiatement ;
     le perdre coûte une réinitialisation complète.

2. **Relever les trois valeurs** dans _Project Settings → API_ :

   | Valeur          | Où elle servira                 |
   | --------------- | ------------------------------- |
   | _Project URL_   | `NEXT_PUBLIC_SUPABASE_URL`      |
   | _anon / public_ | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
   | _service_role_  | `SUPABASE_SERVICE_ROLE_KEY`     |

   ⚠️ **La clé `service_role` contourne toute la sécurité.** Elle ne va jamais
   dans un fichier versionné, ni dans une variable `NEXT_PUBLIC_*`, ni dans un
   message. Si elle fuit, elle se régénère depuis ce même écran — et tout ce qui
   l'utilise doit être redéployé.

3. **Relever la chaîne de connexion** dans _Project Settings → Database →
   Connection string → URI_. C'est `DATABASE_URL`. Remplacez `[YOUR-PASSWORD]`
   par le mot de passe de l'étape 1.

---

## Étape 2 · Appliquer le schéma

```bash
supabase login
supabase link --project-ref <ref-du-projet>   # la ref est dans l'URL du tableau de bord
supabase db push
```

`db push` applique les 25 migrations dans l'ordre. Comptez une à deux minutes.

⚠️ **Jamais l'éditeur SQL du tableau de bord.** Une migration appliquée à la main
n'existe pas dans le dépôt : la production diverge du code, et la divergence se
découvre au déploiement suivant, quand il est trop tard pour savoir ce qui a
changé.

### Le référentiel et les registres

```bash
DATABASE_URL="postgresql://…" npm run db:seed
```

Cela charge les 23 obligations et les 5 registres de commerce. Le seed est
idempotent : le relancer ne duplique rien.

⚠️ **Relisez `supabase/seed/0003_registres_agroespace.sql` avant.** Il porte trois
points marqués « à confirmer » — un numéro de registre au chiffre illisible,
lequel des cinq est le principal, et les dates d'expiration qui manquent. Un
registre faux se corrige ensuite à l'écran **Registres**, mais mieux vaut partir
juste.

### Vérifier que les extensions sont bien là

```sql
select extname from pg_extension where extname in ('pg_cron', 'pg_net');
```

Les deux doivent apparaître. La migration 0025 les crée ; si l'une manque,
activez-la dans _Database → Extensions_ et rejouez `supabase db push`.

⚠️ **Sans `pg_net`, rien ne s'automatise.** Les tâches se planifient très bien et
échouent à chaque déclenchement, dans un journal que personne n'ouvre.

---

## Étape 3 · Le courriel

**Sans cette étape, personne ne peut être invité** : l'invitation est un courriel,
et c'est le seul moyen d'entrer dans l'application.

1. Créer un compte Resend, y **ajouter le domaine** d'AGROESPACE.
2. Poser les enregistrements DNS que Resend indique (SPF, DKIM). Sans eux, les
   messages partent en indésirables — ce qui ressemble beaucoup à « l'invitation
   n'est jamais arrivée ».
3. Créer une clé d'API : c'est `RESEND_API_KEY`.
4. `SMTP_FROM` doit être une adresse **de ce domaine** : `conformia@agroespace.dz`.

Le fournisseur se choisit ensuite **en base**, pas dans le code : écran
**Administration → Réglages**, champ `email_provider`. Une installation qui
préfère le SMTP interne d'AGROESPACE y bascule sans redéploiement.

---

## Étape 4 · L'application sur Vercel

1. vercel.com → _Add New → Project_ → importer le dépôt.
2. Le cadre est détecté tout seul (Next.js). Ne changez ni la commande de build
   ni le répertoire de sortie.
3. **Renseigner les variables d'environnement** — c'est le cœur de l'étape.
   Toutes sont validées au démarrage : une valeur manquante fait échouer le
   build en la nommant, ce qui est très préférable à un démarrage boiteux.

| Variable                        | Valeur                                                   |
| ------------------------------- | -------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | l'URL du projet (étape 1)                                |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | la clé anon (étape 1)                                    |
| `NEXT_PUBLIC_APP_URL`           | `https://conformia.agroespace.dz` — **sans slash final** |
| `NODE_ENV`                      | `production`                                             |
| `SUPABASE_SERVICE_ROLE_KEY`     | la clé service_role (étape 1)                            |
| `DATABASE_URL`                  | la chaîne de connexion (étape 1)                         |
| `RESEND_API_KEY`                | la clé Resend (étape 3)                                  |
| `SMTP_FROM`                     | `conformia@agroespace.dz`                                |
| `SMTP_HOST` `SMTP_PORT`         | ceux de Resend, ou de votre SMTP interne                 |
| `SMTP_USER` `SMTP_PASSWORD`     | idem                                                     |
| `CRON_SECRET`                   | **généré**, voir ci-dessous                              |
| `BACKUP_ENCRYPTION_KEY`         | **générée**, voir ci-dessous                             |
| `LOG_LEVEL`                     | `info`                                                   |

Les deux secrets se fabriquent, ils ne s'inventent pas :

```bash
npm run secrets
```

⚠️ **`BACKUP_ENCRYPTION_KEY` est la seule dont la perte est irréversible.** Elle
chiffre les archives : sans elle, les sauvegardes deviennent un tas d'octets
illisibles. Elle va dans le coffre de l'entreprise, hors de l'application, **le
jour où vous la générez**.

4. _Deploy_. Deux à trois minutes.

5. **Le domaine** : _Settings → Domains_ → ajouter `conformia.agroespace.dz` et
   poser l'enregistrement DNS indiqué. Le certificat HTTPS est automatique.
   Reportez ensuite l'adresse définitive dans `NEXT_PUBLIC_APP_URL` et
   redéployez — les liens des courriels de notification en dépendent.

---

## Étape 5 · Brancher les tâches planifiées

C'est l'étape qu'on oublie, et son oubli ne produit **aucune erreur visible** :
simplement plus aucun dossier créé, plus aucun rappel envoyé.

```bash
DATABASE_URL="postgresql://…" \
NEXT_PUBLIC_APP_URL="https://conformia.agroespace.dz" \
CRON_SECRET="<le même que sur Vercel>" \
npm run cron:config
```

Le script écrit l'adresse publique et le secret dans une table que seule la base
peut lire. ⚠️ **Le `CRON_SECRET` doit être exactement celui de Vercel.** S'ils
diffèrent, chaque appel repart en 401 — et un 401 émis par la base ne remonte
nulle part.

### Vérifier — ne pas supposer

```sql
-- 1. Les deux tâches sont planifiées, et aucune autre.
select jobname, schedule from cron.job where jobname like 'conformia-%';

-- 2. Provoquer un appel tout de suite, sans attendre 2 h du matin.
select public.dispatch_cron_post('generate_occurrences_url');

-- 3. Regarder ce que l'application a répondu (quelques secondes plus tard).
select status_code, accepted, left(response_excerpt, 120)
from public.cron_dispatch_log order by dispatched_at desc limit 5;
```

`status_code = 200` et `accepted = true` : c'est branché. Un **401** signifie que
les secrets diffèrent ; un **404**, que l'adresse est fausse ; **aucune ligne**,
que `pg_net` n'émet rien.

Contrôle final, côté application — écran **Administration → Traitements** : une
ligne `generate-occurrences` doit y apparaître, au statut `SUCCEEDED`.

---

## Étape 6 · Les sauvegardes

⚠️ **Elles ne sont PAS automatisées par la base**, et c'est délibéré : une
sauvegarde est un script qui écrit une archive chiffrée sur un disque
qu'AGROESPACE contrôle. L'application hébergée n'a accès ni à ce disque ni à
`pg_dump`.

Il faut donc une machine qui tourne — un poste bureautique allumé la nuit suffit —
et une tâche planifiée du système d'exploitation :

**Windows** (Planificateur de tâches, tous les jours à 02 h 00) :

```
Programme : C:\Program Files\nodejs\node.exe
Arguments : scripts\backup.ts
Démarrer dans : C:\chemin\vers\conformia
```

**Linux / macOS** (`crontab -e`) :

```cron
0 2 * * *  cd /srv/conformia && npm run backup  >> /var/log/conformia-backup.log 2>&1
0 3 1 * *  cd /srv/conformia && npm run restore:test >> /var/log/conformia-restore.log 2>&1
```

La machine qui sauvegarde a besoin de `DATABASE_URL`, `BACKUP_ENCRYPTION_KEY`,
`BACKUP_DESTINATION` et `BACKUP_STORAGE_SOURCE` dans son environnement.

⚠️ **Une sauvegarde jamais restaurée n'est pas une sauvegarde.** `npm run
restore:test` existe pour cela, et `docs/go-live.md` §D décrit l'épreuve complète —
couper la chaîne quarante heures et vérifier que l'alerte se déclenche. Elle se
fait **une fois, en entier**, avant d'ouvrir à l'équipe.

Supabase fournit en plus ses propres sauvegardes quotidiennes (_Database →
Backups_). Elles ne remplacent pas les vôtres : elles vivent chez le même
hébergeur que la donnée qu'elles protègent.

---

## Étape 7 · Le premier administrateur

L'application n'a pas d'inscription : on entre par invitation, et une invitation
suppose un administrateur. Ce nœud se coupe **une seule fois**, à la main.

1. _Authentication → Users → Add user_. Adresse professionnelle, mot de passe
   provisoire long, **Auto Confirm User** coché.
2. Copier l'identifiant du compte créé.
3. Dans l'éditeur SQL — c'est l'unique exception à la règle, et elle ne touche
   aucun schéma :

```sql
insert into public.user_roles (user_id, role_id, domain_id)
select '<identifiant-du-compte>', r.id, null
from public.roles r where r.code = 'ADMIN';
```

4. Se connecter sur `https://conformia.agroespace.dz`. L'application
   **impose l'enrôlement du second facteur** avant tout le reste : rôle `ADMIN`
   oblige. Prévoyez l'application d'authentification (Google Authenticator,
   Authy) avant de commencer.
5. Changer le mot de passe provisoire.

⚠️ `scripts/create-user.mjs` **ne peut pas** servir ici : il refuse toute base non
locale, délibérément.

---

## Étape 8 · Les comptes de l'équipe

Tout le reste passe par l'écran, plus jamais par SQL. Le détail figure dans le
manuel d'utilisation ; voici la suite d'actions.

**Administration → Comptes → Inviter**, une fois par personne :

| Personne             | Rôle          | Domaine             | Second facteur |
| -------------------- | ------------- | ------------------- | -------------- |
| Le dirigeant         | `DIRECTION`   | Tous les domaines   | **Imposé**     |
| Vous                 | `ADMIN`       | —                   | **Imposé**     |
| Vous (second rôle)   | `RESPONSABLE` | selon votre travail | —              |
| Le comptable         | `RESPONSABLE` | `FISCAL`            | Recommandé     |
| Son remplaçant       | `SUPPLEANT`   | `FISCAL`            | Recommandé     |
| Le responsable RH    | `RESPONSABLE` | `SOCIAL`            | Recommandé     |
| Le chef de service   | `SUPERVISEUR` | son domaine         | Recommandé     |
| Le cabinet comptable | `EXTERNAL`    | `FISCAL`            | —              |
| Le commissaire       | `AUDITOR`     | Tous les domaines   | —              |

Trois choses qui surprennent, et qu'il vaut mieux savoir avant :

- ⚠️ **Un `ADMIN` ne voit aucun dossier.** Ni échéancier, ni documents, ni file de
  validation : ces entrées n'apparaissent pas chez lui. L'administration
  technique et le contenu métier sont séparés. Si vous devez aussi traiter des
  dossiers, cumulez `ADMIN` **et** un rôle métier — ne cherchez pas à élargir
  `ADMIN`.
- ⚠️ **On ne s'attribue pas un rôle à soi-même.** La base refuse. Il faut un
  second administrateur : c'est ce qui empêche une personne seule de s'octroyer
  tous les pouvoirs.
- ⚠️ **`AUDITOR` expire à 90 jours, `EXTERNAL` à 365.** Le champ d'expiration
  devient obligatoire pour ces deux-là. Un accès temporaire qui n'expire pas
  n'est pas temporaire.

Chaque invitation envoie un lien à usage unique ; la personne choisit **son
propre** mot de passe. Aucun mot de passe ne circule par courriel.

---

## Étape 9 · La liste de contrôle avant d'ouvrir

Rien de tout cela ne se suppose — chaque ligne se vérifie.

- [ ] `supabase db push` passé, 25 migrations appliquées
- [ ] `npm run db:seed` passé — 23 obligations, 5 registres
- [ ] `pg_cron` **et** `pg_net` présentes
- [ ] `npm run cron:config` passé, avec le `CRON_SECRET` de Vercel
- [ ] Un appel provoqué à la main répond **200**
- [ ] **Administration → Traitements** montre `generate-occurrences` en `SUCCEEDED`
- [ ] Les dossiers apparaissent dans l'**Échéancier**
- [ ] Un courriel d'invitation arrive réellement, et pas dans les indésirables
- [ ] Le premier administrateur a son second facteur enrôlé
- [ ] Une sauvegarde a tourné, **et a été restaurée une fois**
- [ ] Les **dates d'expiration des registres** sont renseignées
- [ ] Les **fêtes religieuses** de l'année en cours et de la suivante sont saisies
- [ ] Le bandeau du tableau de bord ne montre plus ni `GENERATION_STALE`, ni
      `BACKUP_STALE`, ni `HOLIDAYS_INCOMPLETE`

⚠️ **Les trois dernières lignes sont celles qu'on repousse**, parce que rien ne
casse sans elles. Ce sont aussi les trois qui produisent des échéances fausses
sans le dire : sans dates d'expiration, les renouvellements de registre et
d'agrément ne génèrent **aucun dossier** ; sans jours fériés, chaque échéance
tombant un jour chômé est fausse.

---

## Variante VPS — si les données doivent rester en Algérie

Le principe ne change pas : les deux mêmes pièces, sur une machine que vous
tenez.

1. **Serveur** : Debian 12 ou Ubuntu 24.04, 4 Go de mémoire au minimum, Docker
   installé.
2. **Supabase autogéré** : suivre `supabase/docker` du dépôt officiel. Vous
   devenez alors responsable des mises à jour de sécurité de Postgres, de
   l'authentification et du stockage.
3. **L'application** : construire l'image et la servir derrière un reverse proxy.

```dockerfile
# Dockerfile — à placer à la racine
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
EXPOSE 3000
CMD ["npm", "start"]
```

4. **HTTPS** : Caddy ou nginx + certbot. ⚠️ Jamais en HTTP simple — les sessions
   y transitent.
5. **Les tâches planifiées** fonctionnent à l'identique : `npm run cron:config`
   avec l'adresse interne que la base peut joindre.

⚠️ **Ce que le VPS ajoute vraiment**, ce sont les mises à jour de sécurité, la
surveillance du disque, la rotation des journaux et la reprise après incident.
Ce n'est pas une objection ; c'est le travail qu'il faut nommer avant de le
choisir.

---

## Quand quelque chose ne marche pas

| Symptôme                                       | Cause la plus fréquente                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------ |
| Le build Vercel échoue en nommant une variable | Elle manque — la validation d'environnement fait son travail             |
| Aucun dossier n'apparaît                       | `cron:config` non lancé, ou secrets différents. Voir `cron_dispatch_log` |
| Les invitations n'arrivent pas                 | DNS Resend (SPF/DKIM) non posés, ou `SMTP_FROM` d'un autre domaine       |
| « Échéance légale dépassée » partout           | Rattrapage historique : `npm run db:backfill`, voir `go-live.md` §B.5    |
| Un rôle ne voit pas un écran                   | C'est la matrice qui parle, pas un défaut. Voir le manuel §2             |
| `GENERATION_STALE` au tableau de bord          | La planification est retombée. Reprendre l'étape 5                       |

Le journal d'exploitation courant est dans `docs/runbook.md` ; le retour arrière
migration par migration dans `docs/migrations-rollback.md`.
