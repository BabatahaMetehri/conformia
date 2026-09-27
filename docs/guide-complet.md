# CONFORMIA — guide complet

Tout ce qu'il y a à faire, dans l'ordre, expliqué simplement.

Ce fichier est le **point de départ**. Les autres documents approfondissent :

| Fichier                       | Ce qu'il contient                        |
| ----------------------------- | ---------------------------------------- |
| `docs/deploiement.md`         | Le détail technique de l'installation    |
| `docs/go-live.md`             | Ce qu'il faut avoir réglé avant d'ouvrir |
| `docs/runbook.md`             | Le quotidien : que faire quand ça coince |
| `docs/migrations-rollback.md` | Revenir en arrière sur une migration     |

---

## Partie 0 · Ce que vous avez à faire, en une page

Si vous ne lisez qu'une chose, lisez ceci. Le détail suit.

| #   | À faire                                           | Où                       | Durée  |
| --- | ------------------------------------------------- | ------------------------ | ------ |
| 1   | Créer le projet Supabase                          | supabase.com             | 10 min |
| 2   | Envoyer le schéma et les données                  | votre terminal           | 10 min |
| 3   | Brancher l'envoi de courriels (Resend + DNS)      | resend.com + votre DNS   | 30 min |
| 4   | Mettre l'application en ligne                     | vercel.com               | 20 min |
| 5   | Brancher les tâches automatiques                  | votre terminal           | 5 min  |
| 6   | Créer votre compte administrateur                 | Supabase + l'application | 10 min |
| 7   | Inviter l'équipe                                  | l'application            | 15 min |
| 8   | Saisir les jours fériés religieux                 | l'application            | 15 min |
| 9   | Compléter les registres (dates d'expiration)      | l'application            | 15 min |
| 10  | Charger les trois dernières années                | votre terminal           | 10 min |
| 11  | Faire une sauvegarde **et la restaurer une fois** | votre terminal           | 1 h    |

**Total : une demi-journée**, l'épreuve de sauvegarde comprise.

⚠️ **Les étapes 8, 9 et 11 sont celles qu'on repousse**, parce que rien ne casse
sans elles. Ce sont aussi les trois qui produisent des erreurs silencieuses :
sans jours fériés, les échéances tombant un jour chômé sont fausses ; sans dates
d'expiration, les renouvellements ne génèrent **aucun dossier** ; sans
restauration éprouvée, vous avez des fichiers de sauvegarde dont personne ne sait
s'ils s'ouvrent.

---

## Partie 1 · Pourquoi l'application est lente chez vous

**Vous travaillez en mode développement.** C'est la seule cause, et elle est
mesurée.

En mode développement (`npm run dev`), Next.js **fabrique chaque écran la
première fois que vous l'ouvrez**. Mesures faites sur votre installation :

| Écran       | 1ʳᵉ visite (dev) | 2ᵉ visite (dev) | Production |
| ----------- | ---------------- | --------------- | ---------- |
| Échéancier  | 4 828 ms         | 550 ms          | 307 ms     |
| Registres   | 5 012 ms         | 576 ms          | 437 ms     |
| Documents   | 2 709 ms         | 254 ms          | 136 ms     |
| Référentiel | 2 824 ms         | 370 ms          | 160 ms     |
| Mes tâches  | 1 965 ms         | 260 ms          | 105 ms     |

**En production, tout est déjà fabriqué : 100 à 600 ms.** Ce n'est pas la même
application qui est lente, c'est le mode.

### Ce que j'ai changé

1. **`npm run dev` utilise désormais Turbopack.** Première visite réduite de
   moitié environ : Registres 5 012 → 1 604 ms, Documents 2 709 → 1 367 ms.
2. **Six écrans n'affichaient rien pendant le chargement** — dont Registres, l'un
   des plus lents. Le clic ne répondait pas, la page précédente restait figée, et
   l'on recliquait en croyant avoir raté le bouton. Ils affichent maintenant un
   squelette immédiatement. Cela ne rend pas la page plus rapide : cela rend
   l'attente lisible, et c'est le seul point sur lequel on puisse agir.

### Ce que vous devez faire

**Pour travailler normalement, utilisez la version de production, même en local :**

```bash
npm run build     # une fois, après chaque modification du code
npm start         # puis ouvrez http://localhost:3000
```

Gardez `npm run dev` pour modifier le code — c'est son seul usage.

---

## Partie 2 · Installer Supabase

### 2.1 Créer le projet

1. Aller sur **supabase.com**, se connecter, **New project**.
2. **Nom** : `conformia-production`.
3. **Région** : `eu-central-1` (Francfort) ou `eu-west-3` (Paris) — les plus
   proches de l'Algérie. ⚠️ **Elle ne se change plus après.**
4. **Mot de passe de la base** : cliquez sur _Generate_. ⚠️ Il n'est affiché
   **qu'une seule fois**. Copiez-le immédiatement dans le coffre de l'entreprise.

### 2.2 Relever les quatre valeurs

Dans **Project Settings → API** :

| Ce que vous voyez | À quoi ça sert                                         |
| ----------------- | ------------------------------------------------------ |
| _Project URL_     | l'adresse de la base                                   |
| _anon public_     | clé publique — sans danger, elle va dans le navigateur |
| _service_role_    | ⚠️ **clé maîtresse** — contourne toute la sécurité     |

Dans **Project Settings → Database → Connection string → URI** : la chaîne de
connexion. Remplacez `[YOUR-PASSWORD]` par le mot de passe de l'étape précédente.

⚠️ **La clé `service_role` ne va jamais** dans un fichier partagé, un message,
une capture d'écran, ni dans une variable dont le nom commence par
`NEXT_PUBLIC_`. Si elle fuit, régénérez-la depuis ce même écran.

### 2.3 Envoyer le schéma

```bash
npm install -g supabase
supabase login
supabase link --project-ref <la-ref-dans-l-URL-du-tableau-de-bord>
supabase db push
```

29 migrations s'appliquent. Une à deux minutes.

⚠️ **N'utilisez jamais l'éditeur SQL du site pour cela.** Une modification faite
à la main n'existe pas dans le code : la production s'écarte du dépôt, et
l'écart se découvre au déploiement suivant.

### 2.4 Charger le référentiel et les registres

```bash
DATABASE_URL="postgresql://..." npm run db:seed
```

Cela installe les **23 obligations** (G50, IBS, CNAS, CASNOS, bilan…) et les
**5 registres** d'AGROESPACE. On peut le relancer sans rien dupliquer.

### 2.5 Vérifier les deux extensions

Dans l'éditeur SQL :

```sql
select extname from pg_extension where extname in ('pg_cron', 'pg_net');
```

Les deux doivent apparaître. ⚠️ **Sans `pg_net`, aucune tâche automatique ne
fonctionne** — et elles échouent en silence, dans un journal que personne
n'ouvre.

---

## Partie 3 · Les courriels

**Sans cette partie, personne ne peut être invité ni prévenu.**

1. Créer un compte sur **resend.com**.
2. **Domains → Add Domain** : `agroespace.dz`.
3. Resend affiche des enregistrements **SPF** et **DKIM**. Posez-les chez votre
   hébergeur DNS. ⚠️ **Sans eux, les messages partent en indésirables** — ce qui
   ressemble beaucoup à « l'invitation n'est jamais arrivée ».
4. **API Keys → Create** : c'est votre `RESEND_API_KEY`.

### Changer de fournisseur plus tard

Si AGROESPACE préfère son propre serveur de messagerie : **Administration →
Réglages**, champ `email_provider`, passer de `resend` à `smtp`. Aucun
redéploiement.

⚠️ **Ce réglage ne fonctionnait pas avant aujourd'hui.** Le même paramètre
existait à deux endroits : l'écran écrivait l'un, le système lisait l'autre. Le
changement s'enregistrait, s'affichait correctement, et ne changeait rien.
Corrigé — il n'y a plus qu'un seul endroit.

---

## Partie 4 · Mettre l'application en ligne

1. **vercel.com → Add New → Project** → importer le dépôt.
2. Ne touchez à aucun réglage de construction : tout est détecté.
3. **Ajouter les variables d'environnement** (Settings → Environment Variables) :

| Variable                        | Valeur                                             |
| ------------------------------- | -------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | l'URL du projet                                    |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | la clé anon                                        |
| `NEXT_PUBLIC_APP_URL`           | `https://conformia.agroespace.dz` (sans `/` final) |
| `NODE_ENV`                      | `production`                                       |
| `SUPABASE_SERVICE_ROLE_KEY`     | la clé service_role                                |
| `DATABASE_URL`                  | la chaîne de connexion                             |
| `RESEND_API_KEY`                | la clé Resend                                      |
| `SMTP_FROM`                     | `conformia@agroespace.dz`                          |
| `SMTP_HOST` `SMTP_PORT`         | ceux de Resend ou de votre serveur                 |
| `SMTP_USER` `SMTP_PASSWORD`     | idem                                               |
| `CRON_SECRET`                   | **généré** (voir ci-dessous)                       |
| `BACKUP_ENCRYPTION_KEY`         | **générée** (voir ci-dessous)                      |
| `LOG_LEVEL`                     | `info`                                             |

Les deux secrets se fabriquent :

```bash
npm run secrets
```

⚠️ **`BACKUP_ENCRYPTION_KEY` est la seule dont la perte est définitive.** Elle
chiffre les archives ; sans elle, vos sauvegardes deviennent illisibles pour
toujours. Rangez-la dans le coffre de l'entreprise **le jour où vous la
générez**.

4. **Deploy.**
5. **Settings → Domains** : ajouter `conformia.agroespace.dz`, poser
   l'enregistrement DNS. Le HTTPS est automatique.

---

## Partie 5 · Brancher les tâches automatiques

C'est l'étape qu'on oublie, et son oubli ne produit **aucun message d'erreur** :
simplement plus aucun dossier créé et plus aucun rappel envoyé.

```bash
DATABASE_URL="postgresql://..." \
NEXT_PUBLIC_APP_URL="https://conformia.agroespace.dz" \
CRON_SECRET="<exactement celui de Vercel>" \
npm run cron:config
```

### Vérifier tout de suite — ne pas attendre 2 h du matin

Dans l'éditeur SQL :

```sql
-- Provoquer un appel maintenant
select public.dispatch_cron_post('generate_occurrences_url');

-- Puis, quelques secondes après, regarder la réponse
select status_code, accepted from public.cron_dispatch_log
order by dispatched_at desc limit 3;
```

**`200` et `accepted = true`** : c'est branché.
**`401`** : les deux `CRON_SECRET` ne sont pas identiques.
**`404`** : l'adresse est fausse.
**Aucune ligne** : `pg_net` n'est pas installée.

Puis, dans l'application : **Administration → Traitements** doit montrer une
ligne `generate-occurrences` au statut `SUCCEEDED`.

⚠️ **Ces cinq tâches ne fonctionnaient pas du tout avant aujourd'hui** : l'appel
n'était pas authentifié, l'adresse ne pouvait pas être enregistrée, et `pg_net`
n'était pas installée. Trois d'entre elles visaient même des adresses
inexistantes. Corrigé, et un signal `GENERATION_STALE` apparaît désormais au
tableau de bord si la génération s'arrête plus de 48 h.

---

## Partie 6 · Créer les comptes

### 6.1 Le premier administrateur — une seule fois, à la main

L'application n'a pas d'inscription : on entre par invitation, et une invitation
suppose un administrateur.

1. Supabase → **Authentication → Users → Add user**.
   - adresse professionnelle,
   - mot de passe provisoire long,
   - ⚠️ cocher **Auto Confirm User**.
2. Copier l'identifiant (UUID) du compte créé.
3. Éditeur SQL — **la seule exception à la règle**, et elle ne touche aucun
   schéma :

```sql
insert into public.user_roles (user_id, role_id, domain_id)
select '<uuid-du-compte>', r.id, null
from public.roles r where r.code = 'ADMIN';
```

4. Se connecter. ⚠️ **L'application impose d'enrôler un second facteur avant
   tout** : rôle `ADMIN` oblige. Installez **Google Authenticator** ou **Authy**
   sur votre téléphone **avant** de commencer.
5. Changer le mot de passe provisoire.

### 6.2 Tous les autres — par invitation

**Administration → Comptes → Inviter.** Le formulaire demande :

| Champ         | Ce qu'on y met                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| **Adresse**   | l'adresse professionnelle — c'est l'identifiant **et** l'adresse à laquelle partiront tous les rappels |
| **Nom**       | nom et prénom complets                                                                                 |
| **Téléphone** | facultatif — `0550 12 34 56`                                                                           |
| **Fonction**  | facultatif — « Comptable », « Responsable RH »                                                         |
| **Service**   | rattachement, informatif                                                                               |
| **Rôle**      | voir le tableau ci-dessous                                                                             |
| **Domaine**   | limite le rôle à un métier, ou _tous_                                                                  |

⚠️ **Téléphone et fonction sont nouveaux.** Les colonnes existaient depuis le
début mais aucun formulaire ne les remplissait : elles étaient vides sur tous les
comptes. On s'en aperçoit le jour où l'on cherche le numéro du responsable d'un
dossier en retard.

⚠️ **La fonction n'est pas le rôle.** « Directeur financier » ne valide rien s'il
ne porte pas `SUPERVISEUR` ou `DIRECTION`. Les droits viennent du rôle, et de lui
seul.

### 6.3 Quel rôle pour qui

| Personne             | Rôle          | Domaine     | Durée max |
| -------------------- | ------------- | ----------- | --------- |
| Le dirigeant         | `DIRECTION`   | tous        | illimitée |
| Vous                 | `ADMIN`       | —           | illimitée |
| Vous (second rôle)   | `RESPONSABLE` | selon       | illimitée |
| Le comptable         | `RESPONSABLE` | `FISCAL`    | illimitée |
| Son remplaçant       | `SUPPLEANT`   | `FISCAL`    | illimitée |
| Le responsable RH    | `RESPONSABLE` | `SOCIAL`    | illimitée |
| Le chef de service   | `SUPERVISEUR` | son domaine | illimitée |
| Le cabinet comptable | `EXTERNAL`    | `FISCAL`    | **365 j** |
| Le commissaire       | `AUDITOR`     | tous        | **90 j**  |

**Trois choses qui surprennent tout le monde :**

1. ⚠️ **Un `ADMIN` ne voit AUCUN dossier.** Ni échéancier, ni documents, ni file
   de validation — ces entrées n'apparaissent même pas dans son menu. C'est
   voulu : celui qui distribue les droits ne doit pas lire les déclarations
   fiscales. Si vous devez aussi traiter des dossiers, **cumulez deux rôles**.
2. ⚠️ **On ne peut pas s'attribuer un rôle à soi-même.** La base refuse. Il faut
   un second administrateur — c'est ce qui empêche une personne seule de
   s'octroyer tous les pouvoirs.
3. ⚠️ **Personne ne valide son propre dossier.** Même avec le rôle de
   superviseur.

### 6.4 Ce que reçoit la personne

Un courriel avec un lien à usage unique. **Elle choisit son propre mot de
passe** — aucun mot de passe ne circule jamais par courriel.

Si le courriel n'arrive pas : vérifiez les enregistrements DNS (partie 3), puis
le dossier indésirables.

---

## Partie 7 · Les notifications

### Deux canaux, tous les deux actifs

| Canal                  | Où ça arrive                          | Quand                             |
| ---------------------- | ------------------------------------- | --------------------------------- |
| **Courriel**           | à l'adresse **du profil**             | à chaque cycle, toutes les heures |
| **Dans l'application** | icône cloche, centre de notifications | immédiatement                     |

Les deux partent ensemble : la même alerte laisse une trace dans l'application
**et** dans la boîte de réception.

### Ce qui déclenche un envoi

**Administration → Notifications** règle les jours : 30, 15, 7 et 1 jour avant
l'échéance, puis 1, 3 et 7 jours après. Les alertes tardives montent au
suppléant, puis au superviseur.

### Vérifier que ça marche

Provoquez un cycle sans attendre :

```sql
select public.dispatch_cron_post('notifications_url');
```

puis regardez `cron_dispatch_log`. Le corps de la réponse indique combien de
messages sont partis (`"sent": N`).

⚠️ **Un défaut corrigé aujourd'hui** : les alertes créées par la base partaient
avec un objet illisible — `notifications.backupStale.subject` au lieu de
« Aucune sauvegarde réussie récemment ». Les destinataires recevaient le nom
technique de l'étiquette.

---

## Partie 8 · Archives, sauvegardes et les trois ans

C'est la partie la plus importante à comprendre, et la plus simple une fois dite.

### Ce qui prend de la place

**Ce ne sont pas les dossiers, ce sont les pièces jointes.** Une année
d'activité, c'est quelques centaines de lignes — quelques dizaines de
kilo-octets. Les scans de déclarations, eux, se comptent en gigaoctets, et ils ne
sont pas dans la base mais dans le stockage.

La conservation se joue donc sur **les fichiers**, pas sur les lignes.

### Les trois ans

- **En ligne** : l'exercice courant plus **3 exercices clos**. Immédiatement
  consultable.
- **Au-delà** : les fichiers partent dans une archive chiffrée. ⚠️ **Les fiches
  restent en base** — nom, taille, empreinte SHA-256, qui l'a déposée, qui l'a
  consultée. On peut donc toujours dire « cette pièce a existé, voici sa
  signature, elle est dans l'archive du 15 janvier ».

⚠️ **Trois ans en ligne ≠ trois ans de conservation.** Les obligations
comptables se gardent bien plus longtemps — le référentiel prévoit **dix ans** par
type d'obligation, et rien n'y touche. Ce qui est borné à trois ans, c'est ce qui
reste _immédiatement consultable_.

Le réglage se change sans développeur : **Administration → Réglages**,
`retention_live_years`.

### Voir où on en est

```sql
select * from public.exercise_inventory;
```

Une ligne par année : dossiers, pièces, **octets encore en ligne**, et si
l'exercice dépasse la fenêtre.

### Faire une archive

```bash
npm run backup
```

Produit une archive **chiffrée** de la base **et** des fichiers, déposée dans
`BACKUP_DESTINATION`.

### ⚠️ La restaurer au moins une fois

```bash
npm run restore:test
```

**Une archive jamais restaurée n'est pas une archive : c'est un fichier dont on
espère qu'il s'ouvre.** Faites-le une fois en entier avant d'ouvrir à l'équipe,
puis chaque mois.

### Recharger une archive

```bash
npm run restore -- --archive=/chemin/vers/archive.tar.enc
```

Cela **remplace** le contenu actuel. À faire sur une installation de test si vous
voulez seulement consulter d'anciennes données.

### Les sauvegardes automatiques

⚠️ **Elles ne sont pas déclenchées par la base**, et c'est volontaire : une
sauvegarde écrit sur un disque qu'AGROESPACE contrôle, auquel l'application
hébergée n'a pas accès. Il faut une machine qui tourne — un poste allumé la nuit
suffit.

**Windows**, Planificateur de tâches, tous les jours à 02 h 00 :

```
Programme      : C:\Program Files\nodejs\node.exe
Arguments      : scripts\backup.ts
Démarrer dans  : C:\chemin\vers\conformia
```

**Linux/macOS**, `crontab -e` :

```cron
0 2 * * *  cd /srv/conformia && npm run backup >> /var/log/conformia-backup.log 2>&1
0 3 1 * *  cd /srv/conformia && npm run restore:test >> /var/log/conformia-restore.log 2>&1
```

Supabase fait aussi ses propres sauvegardes quotidiennes. Elles ne remplacent pas
les vôtres : elles vivent chez le même hébergeur que la donnée qu'elles
protègent.

---

## Partie 9 · Charger les trois dernières années

Pour que vos pièces anciennes aient une case où aller :

```bash
npm run db:backfill -- --months 36 --dry-run    # regarder d'abord
npm run db:backfill -- --months 36              # puis appliquer
```

Cela crée les **coquilles archivées** des 36 derniers mois.

⚠️ **Elles sont créées au statut ARCHIVÉ, jamais « à faire ».** Les créer « à
faire » fabriquerait des centaines de dossiers en retard le premier jour — et
apprendrait à l'équipe que les retards affichés ne veulent rien dire.

⚠️ **Déposer une pièce dans un dossier archivé demande de le rouvrir** —
transition `ARCHIVED → SUBMITTED`, réservée à la Direction, avec motif. C'est
plus lourd qu'il n'y paraît : mieux vaut le savoir maintenant.

---

## Partie 10 · Retrouver un dossier précis

**Échéancier**, barre de filtres :

| Filtre              | Ce qu'il fait                                    |
| ------------------- | ------------------------------------------------ |
| **Année**           | _(nouveau)_ liste déroulante : 2025, 2026, 2027… |
| **Période précise** | `2026-03` pour le seul mois de mars              |
| **Établissement**   | un des cinq registres                            |
| **Domaine**         | fiscal, social, juridique, réglementaire         |
| **Organisme**       | DGI, CNAS, CASNOS…                               |
| **Responsable**     | la personne en charge                            |
| **Statut**          | à faire, en cours, validé, déposé, archivé       |
| **Criticité**       | critique, haute, moyenne, basse                  |
| **En retard**       | bascule                                          |

⚠️ **Année et période précise écrivent le même filtre**, et c'est voulu : le
filtre porte sur un **préfixe**. « 2026 » retient toute l'année, « 2026-03 » le
seul mois de mars. Choisir une année élargit ; taper un mois précise.

Avant aujourd'hui, filtrer par année supposait de deviner qu'un champ libre
acceptait « 2026 ». Personne ne le devinait.

Le bouton **Exporter** produit un classeur Excel du contenu filtré.

---

## Partie 11 · Sécurité — ce qui a été vérifié

Audit complet du schéma. **Ce qui est sain :**

- aucune table sans protection RLS ;
- aucune règle d'accès permissive ;
- aucune fonction privilégiée mal configurée ;
- aucun espace de stockage public ;
- testé sans session : `profiles`, dossiers, documents, réglages et journal
  d'audit rendent **zéro ligne** ;
- les fonctions sensibles se défendent elles-mêmes — `deactivate_user` et
  `reset_user_mfa` appelées sans droits répondent « user.manage requis ».

**Deux portes refermées :**

1. ⚠️ **La sonde de santé était publique.** N'importe qui, sans compte, pouvait
   lire l'état des sauvegardes, le nombre de documents et les tâches en échec —
   donc savoir **quand une destruction coûterait le plus cher**. Réservée au rôle
   de service.
2. ⚠️ **`TRUNCATE` était accordé à tout le monde** sur 103 tables, héritage des
   réglages par défaut de Supabase. `TRUNCATE` **n'est pas filtré par la RLS** :
   il vide une table sans rien vérifier. Retiré, y compris pour les tables à
   venir.

### Ce que vous devez faire, vous

- ⚠️ **Second facteur obligatoire** pour vous et le dirigeant — imposé par
  l'application.
- ⚠️ **La clé `service_role` et `BACKUP_ENCRYPTION_KEY`** dans le coffre, jamais
  dans un message.
- **Deux administrateurs minimum** — on ne peut pas s'attribuer un rôle à
  soi-même, donc un administrateur seul ne peut pas être dépanné.
- **Retirer les accès des partants** le jour même : Administration → Comptes →
  Désactiver. Si la personne porte des dossiers, l'application **exige** de
  désigner un repreneur.

---

## Partie 12 · La liste finale avant d'ouvrir

- [ ] `supabase db push` — 29 migrations
- [ ] `npm run db:seed` — 23 obligations, 5 registres
- [ ] `pg_cron` **et** `pg_net` présentes
- [ ] `npm run cron:config`, et un appel provoqué répond **200**
- [ ] Administration → Traitements montre `generate-occurrences` en `SUCCEEDED`
- [ ] Des dossiers apparaissent dans l'Échéancier
- [ ] Un courriel d'invitation arrive vraiment (pas dans les indésirables)
- [ ] Votre second facteur est enrôlé
- [ ] Une sauvegarde a tourné **et a été restaurée une fois**
- [ ] Les **dates d'expiration des registres** sont saisies
- [ ] Les **fêtes religieuses** de cette année et de la suivante sont saisies
- [ ] Le tableau de bord ne montre plus `GENERATION_STALE`, `BACKUP_STALE` ni
      `HOLIDAYS_INCOMPLETE`

---

## Partie 13 · Quand quelque chose ne marche pas

| Ce que vous voyez                             | Ce que c'est                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| L'application est lente                       | Vous êtes en mode développement. `npm run build && npm start`            |
| Le déploiement échoue en nommant une variable | Elle manque — la validation fait son travail                             |
| Aucun dossier n'apparaît                      | `cron:config` non lancé, ou secrets différents. Voir `cron_dispatch_log` |
| Les invitations n'arrivent pas                | DNS Resend (SPF/DKIM) non posés                                          |
| « En retard » partout au premier jour         | Rattrapage historique : voir partie 9                                    |
| Un rôle ne voit pas un écran                  | C'est la matrice des rôles, pas un défaut                                |
| `GENERATION_STALE` au tableau de bord         | La planification est tombée. Refaire la partie 5                         |
| `HOLIDAYS_INCOMPLETE`                         | Les fêtes religieuses de l'an prochain manquent                          |

---

## Ce qui reste en attente de vous

1. **Les fêtes religieuses 2026 et 2027** — Aïd el-Fitr, Aïd el-Adha, Awal
   Moharem, Achoura, Mawlid Ennabaoui. Fixées par décret, **elles ne se
   calculent pas**. Gabarit prêt : `docs/templates/jours-feries.csv`.
2. **Les dates d'expiration des cinq registres** — sans elles, les
   renouvellements ne génèrent aucun dossier.
3. **Le numéro du registre 58/02** — deuxième chiffre illisible sur la note.
4. **Lequel des cinq registres est le principal** — 58/00 retenu par déduction.
5. **La date de la déclaration CASNOS** — janvier ou février selon les sources.
6. **Les trois acomptes IBS** (20/03, 20/06, 20/11) — à confirmer.

⚠️ **Aucune de ces dates n'a été devinée.** Une échéance fausse ne produit aucune
erreur visible : seulement un rappel au mauvais moment, auquel l'équipe prend
l'habitude de se fier.
