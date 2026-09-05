# Mise en production

Ce document est une **liste d'exécution**, pas une présentation. Chaque section
dit ce qu'il faut faire, dans quel ordre, et à quoi l'on reconnaît que c'est
fait. Ce qui n'a pas de critère observable n'est pas une étape : c'est une
intention.

⚠️ **Rien de ce qui suit ne se délègue à l'outil.** L'application est prête ; ce
qui reste tient à des secrets, des données réelles, des personnes et une
infrastructure — quatre choses qu'aucun code ne peut produire à votre place.

---

## Où en est le dépôt

Fait, vérifiable, déjà dans le code :

| Point                      | État                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Artefacts de développement | Aucun. Ni écran de démonstration, ni route de test, ni compte semé.                                          |
| Jeu de départ              | `supabase/seed/` ne contient que le référentiel métier — aucun compte, aucune donnée fictive.                |
| Garde-fou de production    | `scripts/seed.mjs` et `scripts/create-user.mjs` refusent `NODE_ENV=production` **et** toute base non locale. |
| Secrets dans le dépôt      | Aucun. `gitleaks` passe sur les 44 commits de l'historique.                                                  |
| Intégration continue       | `.github/workflows/ci.yml` — bloquante, sans étape facultative.                                              |

⚠️ **Deux points de la liste initiale n'existaient pas** : il n'y a jamais eu de
route `/_design-system`, ni de fichier `dev_users.sql`. Le seul outil qui
fabrique des comptes est `scripts/create-user.mjs`, désormais gardé.

---

## A · Secrets

### Où vit chaque secret, et qui peut le lire

| Secret                          | Émis par          | Vit dans                                        | Lu par                         |
| ------------------------------- | ----------------- | ----------------------------------------------- | ------------------------------ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase          | Variables de l'hébergeur + navigateur           | Tout le monde — c'est son rôle |
| `SUPABASE_SERVICE_ROLE_KEY`     | Supabase          | Variables de l'hébergeur, **serveur seul**      | Les tâches planifiées          |
| `DATABASE_URL`                  | Supabase          | Variables de l'hébergeur                        | Migrations, sauvegarde         |
| `RESEND_API_KEY`                | Resend            | Variables de l'hébergeur                        | Le diffuseur de notifications  |
| `CRON_SECRET`                   | `npm run secrets` | Variables de l'hébergeur **et** planificateur   | Les deux, et personne d'autre  |
| `BACKUP_ENCRYPTION_KEY`         | `npm run secrets` | **Coffre de l'entreprise, hors infrastructure** | Voir plus bas                  |

```bash
npm run secrets          # produit CRON_SECRET et BACKUP_ENCRYPTION_KEY
```

Le script **n'écrit dans aucun fichier**. Il affiche, on copie, le terminal se
ferme. Un script qui remplirait `.env.local` finirait par remplir un fichier
suivi par git, un jour où quelqu'un l'aurait lancé depuis le mauvais dossier.

### Ordre de rotation — il compte

1. **`RESEND_API_KEY`** — créer la nouvelle, la déployer, **puis** révoquer
   l'ancienne. L'inverse coupe les notifications entre les deux gestes.
2. **`CRON_SECRET`** — poser la même valeur des **deux** côtés au même moment.
   Un décalage n'affiche aucune erreur : les échéances cessent simplement d'être
   générées, et cela ne se voit qu'à la première manquée.
3. **Clés Supabase** — « Rotate » invalide l'ancienne **immédiatement**. Préparer
   le remplacement dans les variables de l'hébergeur d'abord, faire tourner
   ensuite, redéployer dans la foulée.
4. **`BACKUP_ENCRYPTION_KEY`** — voir la section suivante. Ne se tourne pas comme
   les autres.

### ⚠️ `BACKUP_ENCRYPTION_KEY` — la seule dont la perte est irréversible

Cette clé chiffre les archives. **Une sauvegarde dont la clé est perdue n'est pas
une sauvegarde** : c'est un fichier que personne ne pourra jamais ouvrir, y
compris vous, y compris l'hébergeur, y compris avec un mandat de justice.

Trois règles, et elles ne se négocient pas :

1. **Hors de l'infrastructure applicative.** Pas dans les variables de
   l'hébergeur au même endroit que le reste, pas dans le dépôt, pas dans un
   gestionnaire de mots de passe hébergé par le même fournisseur que la base.
   Un incident qui emporte l'infrastructure ne doit pas emporter la clé qui
   permet d'en sortir.
2. **Hors des sauvegardes.** Chiffrer la clé avec elle-même n'a pas de sens ;
   l'inclure en clair dans l'archive annule le chiffrement.
3. **En deux exemplaires, en deux lieux, connus de deux personnes.** Un seul
   exemplaire, c'est un point de défaillance ; une seule personne qui la
   connaît, c'est un point de défaillance qui prend des congés.

**Forme recommandée** : la clé imprimée sur papier, dans une enveloppe scellée,
dans le coffre d'AGROESPACE — plus un second exemplaire chez le dirigeant. Le
papier ne se corrompt pas, ne dépend d'aucun format, et ne se copie pas par
accident.

**Récupération — la procédure, à relire une fois par an :**

```bash
# 1. Récupérer l'archive et la clé (deux endroits différents, par construction)
# 2. Vérifier que la clé est la bonne AVANT d'en avoir besoin :
BACKUP_ENCRYPTION_KEY="…" npm run restore:test
#    → restaure dans une base jetable et compare les empreintes.
#    Si cette commande échoue, la clé n'est pas la bonne. Le savoir maintenant
#    coûte cinq minutes ; le savoir le jour de l'incident coûte l'entreprise.
```

⚠️ **Si la clé doit changer** : produire la nouvelle, **conserver l'ancienne** —
les archives déjà écrites restent chiffrées avec elle — et noter la date de
bascule à côté de chaque exemplaire. Une clé remplacée sans conserver la
précédente rend illisible tout l'historique d'un coup.

---

## B · Données de production

### 1. Jours fériés — ⚠️ **le point le plus urgent de cette liste**

**État constaté :** la base contient **cinq** jours fériés, tous civils et à date
fixe, tous en **2026** :

| Date  | Fête                          |
| ----- | ----------------------------- |
| 01/01 | Nouvel an                     |
| 12/01 | Yennayer                      |
| 01/05 | Fête du Travail               |
| 05/07 | Fête de l'Indépendance        |
| 01/11 | Anniversaire de la Révolution |

**Ce qui manque, et ce que cela coûte :**

- **Les fêtes religieuses de 2026** — Aïd el-Fitr, Aïd el-Adha, Awal Moharem,
  Achoura, Mawlid Ennabaoui. Elles suivent le calendrier hégirien et sont fixées
  **par décret**. Elles ne se calculent pas : aucun code ne peut les deviner, et
  ce document ne les invente pas. Sans elles, une échéance tombant un jour de
  Aïd est calculée comme un jour ouvré — et le décalage réglementaire n'est pas
  appliqué.
- **L'année 2027, entièrement.** ⚠️ Attention au piège : la colonne
  `is_recurring` est **informative**. Le calcul d'échéance lit des dates exactes
  (`loadHolidayDates`) ; une fête marquée « récurrente » en 2026 **ne protège
  pas** 2027. Chaque année doit être saisie.

**À faire :** obtenir du cabinet comptable ou du Journal officiel la liste des
jours chômés 2026 et 2027, puis les saisir dans
**Administration → Référentiels**, ou par import CSV sur le même écran.

**Le rappel annuel — corrigé.** La tâche qui devait créer chaque 1er décembre le
dossier « Mise à jour du calendrier N+1 » était écrite, testée… et **appelée par
personne** : ni pg_cron, ni route, ni tâche. Elle n'aurait jamais tiré. Deux
défauts s'y ajoutaient : aucune garde de date (elle aurait recréé le dossier
chaque matin) et deux `ON CONFLICT` désignant des contraintes inexistantes, qui
la faisaient échouer à sa première exécution réelle. Corrigé, greffé sur la
génération quotidienne, et éprouvé par
`tests/integration/holiday-reminder.test.ts`.

### 2. Registres de commerce

Écran **Registres → Nouveau**. Pour chaque établissement : numéro RC, type
(principal / secondaire / annexe), libellé, date de délivrance, activité.

⚠️ **Le type conditionne la génération.** Une obligation `PER_REGISTER` produit
un dossier **par registre actif**. Saisir un registre de trop, c'est une
colonne de dossiers de trop, tous les mois.

### 3. Révision des 23 obligations

Le référentiel livré compte **23** obligations (et non 22). Pour chacune :

- **s'applique-t-elle ?** Sinon : la désactiver, ne pas la supprimer —
  l'historique doit rester lisible ;
- **`ENTITY` ou `PER_REGISTER` ?** Une obligation qui vaut pour l'entreprise
  entière ne doit pas se multiplier par établissement ;
- **l'échéance est-elle la bonne ?** L'écran affiche les six prochaines dates
  calculées : c'est là qu'une règle fausse se voit.

### 4. Échéances — une corrigée, une encore ouverte

**CNAS-DAS — CORRIGÉ.** La valeur de départ était le **31 mars** ; c'est le
**31 janvier**. ⚠️ L'erreur allait dans le sens qui coûte : elle faisait croire
qu'il restait deux mois. Le référentiel livré porte désormais la bonne date, et
l'échéance interne tombe quinze jours ouvrés plus tôt — vérifié : période 2026,
échéance légale au 31/01/2027, interne au 10/01/2027.

**CASNOS — PARTIELLEMENT RÉSOLU. C'est la dernière question ouverte du projet.**

L'obligation se dédouble, et le référentiel n'en portait qu'une moitié :

| Étape                         | Date                           | État                                                          |
| ----------------------------- | ------------------------------ | ------------------------------------------------------------- |
| **Paiement** de la cotisation | 30 juin                        | **Confirmé.** C'est la ligne `CASNOS`, renommée pour le dire. |
| **Déclaration** préalable     | fin janvier **ou** fin février | ⚠️ **Non confirmée. Aucune obligation n'est créée.**          |

⚠️ **L'obligation manquante n'a volontairement pas été créée.** La créer avec
une date devinée serait pire que son absence : une échéance fausse ne produit
aucune erreur visible, seulement un rappel au mauvais moment — et l'équipe
prendrait l'habitude de s'y fier. Une obligation absente, au moins, se remarque.

**À faire, dès que la date est confirmée :** Référentiel → Nouvelle obligation,
domaine SOCIAL, organisme CASNOS, périodicité annuelle, ancre à date fixe. Les
six prochaines dates s'affichent avant l'enregistrement : c'est là qu'une erreur
de saisie se voit.

**Restent à confirmer par ailleurs :** les trois acomptes IBS (20/03, 20/06,
20/11), retenus sans source ferme.

Toute correction se fait dans l'interface, avec prévisualisation immédiate. Un
recalcul des occurrences **futures** est proposé après modification ; les
dossiers passés ne bougent jamais.

### 5. Rattrapage historique

```bash
npm run db:backfill -- --months 12 --dry-run   # lire d'abord
npm run db:backfill -- --months 12             # puis appliquer
```

Crée les coquilles des douze mois précédents au statut **ARCHIVED** : elles
n'apparaissent dans aucune file et ne comptent dans aucun retard. Sans elles, un
justificatif de mars n'a nulle part où aller.

⚠️ **À savoir avant de verser une pièce ancienne** : une occurrence archivée est
immuable. Y déposer un document suppose de **rouvrir** le dossier (transition
`ARCHIVED → SUBMITTED`, permission `occurrence.unlock`, motif obligatoire).
C'est plus lourd que l'intention initiale ne le laissait croire.

---

## C · Comptes réels

### Amorçage du premier administrateur

L'application n'a pas d'inscription : on entre par invitation, et une invitation
suppose un administrateur. Ce nœud se coupe **une seule fois**, à la main :

```sql
-- Sur la base de production, par la console SQL Supabase, une seule fois.
-- 1. Créer le compte par l'interface Supabase (Authentication → Add user),
--    avec un mot de passe provisoire long, envoyé par un canal séparé.
-- 2. Lui attribuer le rôle ADMIN :
insert into public.user_roles (user_id, role_id, domain_id)
select '<uuid-du-compte>', r.id, null
  from public.roles r where r.code = 'ADMIN';
```

Puis, **à la première connexion** : changement du mot de passe et **enrôlement
MFA immédiat**. Le middleware l'impose déjà pour ADMIN et DIRECTION — la
première session ne va nulle part sans second facteur.

⚠️ `scripts/create-user.mjs` **ne peut pas** servir ici : il refuse toute base
non locale, délibérément.

### Les autres comptes — par invitation, jamais par mot de passe imposé

Écran **Administration → Utilisateurs → Inviter**. L'invitation envoie un lien à
usage unique ; la personne choisit son propre mot de passe. Aucun mot de passe ne
circule par courriel — c'est le seul régime acceptable, et l'application n'en
propose pas d'autre.

| Personne       | Rôle                                           | MFA             |
| -------------- | ---------------------------------------------- | --------------- |
| Vous           | `ADMIN` **+** un second rôle (voir ci-dessous) | **Obligatoire** |
| Le dirigeant   | `DIRECTION`                                    | **Obligatoire** |
| Le préparateur | `RESPONSABLE`                                  | Recommandée     |
| Son remplaçant | `SUPPLEANT`                                    | Recommandée     |
| Le contrôleur  | `SUPERVISEUR`                                  | Recommandée     |

### ⚠️ Votre propre compte — cumulez, n'élargissez pas

Le rôle `ADMIN` ne donne accès **ni aux dossiers, ni aux documents**. C'est
délibéré, c'est éprouvé (`e2e/critical-journeys.spec.ts`, parcours 5), et c'est
expliqué dans `docs/security.md`.

Si vous devez aussi consulter les dossiers : **ajoutez-vous un second rôle** —
`SUPERVISEUR` ou `DIRECTION` — sur le même compte. Le cumul est prévu par le
modèle : les permissions s'additionnent, et la trace d'audit distingue toujours
au titre de quoi vous avez agi.

**N'élargissez pas `ADMIN`.** Lui donner `occurrence.read` ferait de la personne
qui installe le logiciel la mieux informée de l'entreprise, et romprait la seule
séparation que ce modèle protège vraiment.

### Comptes à durée bornée

```sql
-- Aucun AUDITOR ni EXTERNAL ne doit exister sans expiration.
-- La base l'impose déjà (contrainte + max_duration_days) ; on le VÉRIFIE :
select p.email, r.code, ur.expires_at
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  join public.profiles p on p.id = ur.user_id
 where r.code in ('AUDITOR', 'EXTERNAL')
   and ur.revoked_at is null
   and ur.expires_at is null;
-- Résultat attendu : zéro ligne.
```

---

## D · Sauvegarde — pour de vrai

### La répétition, une fois, en entier

```bash
npm run backup                      # 1. sauvegarde complète réelle
npm run restore:test                # 2. restauration dans une base jetable
```

⚠️ **Chronométrer la restauration et consigner la durée** dans
`docs/runbook.md`, section « Restauration ». Une durée inconnue est une durée
qu'on découvrira le jour de l'incident, devant quelqu'un qui attend une réponse.

### La copie chiffrée arrive-t-elle vraiment chez AGROESPACE ?

`BACKUP_DESTINATION` ou `BACKUP_RCLONE_REMOTE` doit pointer vers un
emplacement **contrôlé par l'entreprise** — poste dédié ou NAS. Une sauvegarde
qui reste sur la machine sauvegardée n'en est pas une.

Vérifier, sur place : le fichier est là, sa taille est plausible, et **une
deuxième personne sait où il est et comment y accéder**. Une sauvegarde que seule
une personne sait retrouver a la fiabilité de cette personne.

### ⚠️ Couper la chaîne 40 heures — l'épreuve qui compte

Le seuil est de **36 heures** (`BACKUP_STALE_AFTER_HOURS`). Quarante heures le
dépassent franchement.

```sql
-- Simuler l'absence de sauvegarde sans rien casser :
update public.backup_runs
   set finished_at = now() - interval '40 hours'
 where status = 'SUCCEEDED';
```

Puis attendre le cycle horaire de notification (minute 5 de chaque heure).

**Ce qu'on doit constater :** l'alerte arrive **dans la boîte d'une personne
réelle**, et pas seulement dans une table. Si elle n'arrive pas, le dispositif
d'alerte est décoratif — et la panne classique n'est pas la sauvegarde qui
échoue, c'est celle qui échoue **silencieusement pendant huit mois**.

---

## E · Supervision

| À brancher           | Sur quoi                              | Critère                                                    |
| -------------------- | ------------------------------------- | ---------------------------------------------------------- |
| Sonde externe        | `GET /api/health`                     | `503` déclenche une alerte                                 |
| Suivi d'erreurs      | Serveur + navigateur                  | Une erreur provoquée apparaît, **sans donnée personnelle** |
| Échec de tâche       | `job_runs.status = 'FAILED'`          | Alerte                                                     |
| **Absence** de tâche | `job_runs` sans exécution depuis 26 h | Alerte — c'est le silence qui tue, pas l'échec             |

⚠️ **Ne pointez pas la sonde sur l'URL d'une fiche.** Elle répond `200` même pour
une ressource disparue — écart assumé, `docs/decisions.md` § 15 — et rassurerait
au lieu d'alerter. `/api/health`, et rien d'autre.

**Envoyer réellement chaque type d'alerte une fois**, et vérifier la réception :
échéance à venir, retard, escalade, validation attendue, rejet, sauvegarde
périmée, intégrité, échec d'envoi. Une alerte jamais reçue est une alerte dont on
ignore si elle fonctionne.

---

## F · Sécurité en conditions réelles

À exécuter **sur l'environnement déployé**, pas en local :

- **CSP avec nonce** — ouvrir chaque écran, console ouverte : zéro violation.
  Une CSP qui refuse un style n'affiche pas d'erreur, elle affiche un écran faux.
- **Limitation de débit** — vérifier qu'une rafale d'écritures rend bien `429`.
- **En-têtes** — scanner externe (`securityheaders.com` ou équivalent). HTTPS
  forcé, **HSTS actif**.
- **Route Handlers** — pour chacune : sans session, avec une session
  insuffisante, puis avec la bonne. Trois réponses distinctes attendues.
  `e2e/security.spec.ts` le fait déjà en local ; le refaire en ligne.

---

## G · Déploiement

### Pré-production

Miroir fidèle : mêmes migrations, mêmes variables (valeurs différentes), **données
fictives**. C'est là que se répètent les migrations et les restaurations.

### Migrations

```bash
supabase db push        # jamais par l'interface web
```

⚠️ **Jamais l'éditeur SQL de l'interface.** Une migration appliquée à la main
n'existe pas dans le dépôt : la pré-production et la production divergent
silencieusement, et la divergence se découvre au déploiement suivant.

**Retour arrière par migration** — le tableau vit dans
`docs/migrations-rollback.md`. Toute nouvelle migration l'y ajoute une ligne
**dans le même commit**.

### Intégration continue

`.github/workflows/ci.yml` — bloquante. Typage, lint, format, tests unitaires,
migrations, types à jour, intégration (RLS, politiques, jobs), build, bout en
bout, et `gitleaks` sur l'historique complet. **Aucun déploiement sans suite
verte.**

### Plan de retour arrière

| Question                            | Réponse                                                                                                                                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Qui décide ?**                    | Vous, ou le dirigeant en votre absence. Une seule personne, nommée à l'avance.                                                                                                                                  |
| **Sur quoi ?**                      | Un dossier corrompu, une échéance fausse en production, une fuite de données, un écran inaccessible pour un rôle.                                                                                               |
| **En combien de temps ?**           | Redéploiement de la version précédente : minutes. Retour arrière d'une migration : voir `docs/migrations-rollback.md`. Restauration complète : **durée à mesurer** (section D).                                 |
| **Comment ?**                       | 1. Redéployer le commit précédent. 2. Si une migration est en cause, appliquer son retour arrière documenté. 3. Si des données sont corrompues, restaurer — et accepter la perte depuis la dernière sauvegarde. |
| **Qui prévient les utilisateurs ?** | Vous, avant le retour arrière, pas après.                                                                                                                                                                       |

⚠️ **Ce plan doit être relu par quelqu'un qui ne l'a pas écrit.** Un plan de
retour arrière relu par son auteur ne teste que sa propre cohérence.

---

## H · Pilote

### Un cycle mensuel complet, un seul utilisateur

Ouvrir au **seul responsable**. Objectif unique et vérifiable : **un G50 réel
traité de bout en bout dans l'outil** — prise en charge, dépôt des pièces,
soumission, validation, dépôt effectif, archivage.

**Ne pas ouvrir aux autres avant la fin du cycle.** Une friction rencontrée par
une personne se corrige ; la même rencontrée par cinq personnes devient une
opinion sur l'outil.

### Consigner chaque friction, même mineure

Un fichier, une ligne par friction : date, écran, ce qui était attendu, ce qui
s'est passé. ⚠️ **Les mineures surtout** : ce sont elles qui décident si l'outil
est adopté ou contourné. Une friction majeure se signale toute seule ; une
friction mineure se contourne en silence, et le contournement devient l'usage.

### Formation

Un guide **par rôle**, deux pages maximum, illustré — `docs/guides/`. Une session
de **30 minutes par personne**, sur ses propres dossiers, pas sur un exemple.

### ⚠️ La question qui reviendra

> « Pourquoi l'administrateur ne voit-il pas les documents ? »

Elle reviendra, elle ressemblera à un bug, et la réponse est dans
`docs/guides/pourquoi-admin-ne-voit-pas.md`. La lire **avant** la première
session : la réponse improvisée est toujours moins convaincante que la réponse
préparée, et celle-ci se défend très bien.
