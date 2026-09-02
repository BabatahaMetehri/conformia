# Stratégie de sauvegarde

> La panne classique n'est pas la sauvegarde qui échoue : celle-là se voit. C'est
> celle qui échoue **silencieusement** pendant huit mois, et qu'on découvre le
> jour où il faut restaurer. Tout ce document est organisé autour de cette
> phrase.

## Ce qu'il y a à perdre

| Donnée                                 | Où elle vit                                    | Reconstituable ?                                   |
| -------------------------------------- | ---------------------------------------------- | -------------------------------------------------- |
| Référentiel des obligations            | PostgreSQL                                     | Oui, mais au prix d'un arbitrage cabinet comptable |
| Occurrences, transitions, affectations | PostgreSQL                                     | **Non**                                            |
| Journal d'audit                        | PostgreSQL, partitionné, en ajout seul         | **Non** — et c'est lui qu'un contrôleur lit        |
| Pièces déposées                        | Stockage objet (bucket `compliance-documents`) | **Non**                                            |
| Comptes et habilitations               | `auth.users` + `public.profiles`               | Partiellement                                      |

⚠️ **La base seule ne suffit pas.** Une restauration sans le stockage rend une
application où chaque dossier existe et où chaque pièce a disparu : les écrans
fonctionnent, les liens de téléchargement échouent un par un. C'est pourquoi
`scripts/backup.ts` **refuse de s'exécuter** sans `BACKUP_STORAGE_SOURCE`, sauf
`BACKUP_ALLOW_DB_ONLY=true` posé sciemment.

---

## Les trois niveaux

### Niveau 1 — Sauvegarde continue managée

Point-in-time recovery de l'hébergeur, **rétention 7 jours**.

- Couvre l'erreur humaine récente : un `DELETE` malheureux, une migration ratée.
- Granularité à la seconde, restauration par l'hébergeur.
- **Ne couvre pas** la perte du compte hébergeur, ni une décision de
  localisation légale des données. D'où le niveau 2.

À activer dans la console Supabase : _Database → Backups → Point in Time
Recovery_. Sur une instance auto-hébergée, l'équivalent est
`wal-g` / `pgBackRest` configuré sur le serveur PostgreSQL.

### Niveau 2 — Export logique quotidien, rapatrié et chiffré

`scripts/backup.ts`, **03 h 00 heure d'Alger**.

1. `pg_dump --clean --if-exists --format=plain`, comprimé en gzip.
2. Copie du stockage documentaire (rclone, ou chemin monté).
3. Assemblage en `.tar`, puis **chiffrement AES-256-GCM**.
4. Transfert vers un support **contrôlé par AGROESPACE** — répertoire local du
   serveur d'entreprise, ou remote rclone (NAS).
5. **Relecture à destination** : taille et empreinte SHA-256 revérifiées.
6. Consignation dans `backup_runs` **et** `job_runs`.

⚠️ L'étape 5 est celle qu'on saute et qu'il ne faut pas sauter. Un `cp` qui rend
0 dit que l'écriture a été **acceptée**, pas que les octets sont **lisibles** :
disque plein en fin de copie, montage réseau qui tombe, quota atteint. Sans
relecture, `verified_at` reste nul — et une ligne `SUCCEEDED` sans `verified_at`
doit être lue comme un doute, pas comme un succès.

### Niveau 3 — Archive mensuelle, conservée 24 mois

La sauvegarde du 1er du mois est copiée dans un emplacement à rotation lente.
Vingt-quatre mois : la durée pendant laquelle un contrôle fiscal peut réclamer un
exercice révolu.

---

## Rotation

| Cadence      | Conservées | Couvre                                |
| ------------ | ---------- | ------------------------------------- |
| Quotidienne  | 7          | l'incident de la semaine              |
| Hebdomadaire | 4          | l'erreur découverte au bout d'un mois |
| Mensuelle    | 12         | l'exercice en cours                   |
| Archive      | 24 mois    | le contrôle sur exercice révolu       |

La rotation n'est **pas** faite par le script : elle est déléguée à l'outil qui
détient l'espace (politique de cycle de vie du NAS, `rclone` avec
`--max-age`, ou `logrotate`). Un script de sauvegarde qui supprime des
sauvegardes est un script qui peut supprimer la mauvaise.

---

## Chiffrement

- **AES-256-GCM**, clé dérivée par `scrypt` d'un sel aléatoire par archive.
- Format : `[sel 16][vecteur 12][chiffré …][marqueur d'authenticité 16]`.
- GCM et non CBC : il **authentifie** en plus de chiffrer. Une archive modifiée
  d'un octet fait échouer le déchiffrement au lieu de rendre des données fausses.

⚠️ **La clé ne voyage jamais avec l'archive.** `BACKUP_ENCRYPTION_KEY` vit dans
l'environnement du serveur qui sauvegarde, et **dans le coffre de l'entreprise**.
Une archive chiffrée déposée à côté de sa clé est une archive en clair.

⚠️ **Perdre la clé, c'est perdre les archives.** Il n'existe aucune récupération.
La consigner hors ligne fait partie de la mise en service, pas des « bonnes
pratiques à faire un jour ».

---

## L'alerte — le vrai sujet

Une notification part vers **tous les ADMIN et la DIRECTION**, en interne _et_
par courriel, dès qu'**aucune sauvegarde n'a réussi depuis 36 heures**.

- Portée par `notify_admins_of_stale_backup()`, appelée à **chaque cycle horaire
  de notification** — pas par une tâche dédiée. Une alerte de sauvegarde portée
  par son propre planificateur dépendrait d'un dispositif dont personne ne
  surveille la santé, et se tairait exactement quand elle devrait parler.
- **L'absence totale de sauvegarde déclenche l'alerte au même titre** qu'une
  sauvegarde périmée. Une installation neuve alerte donc dès la première heure,
  et c'est voulu : une table vide traitée comme « tout va bien » est la forme la
  plus pure du dispositif décoratif.
- Une alerte par personne et par canal toutes les 24 h. Répétée toutes les
  heures, elle ne serait plus lue au bout de deux jours.
- 36 h et non 24 : un incident isolé et rattrapé ne réveille personne ; deux
  échecs consécutifs, si.

Le bandeau du tableau de bord existe aussi, mais il ne suffit pas — il faut
ouvrir un écran d'administration pour le voir.

---

## Configuration

```bash
# Obligatoires
BACKUP_ENCRYPTION_KEY="…"          # 32 caractères minimum, hors de l'application
BACKUP_DESTINATION="/srv/backups"  # OU BACKUP_RCLONE_REMOTE
BACKUP_STORAGE_SOURCE="…"          # chemin monté, ou remote rclone du bucket

# Facultatifs
BACKUP_RCLONE_REMOTE="nas:conformia"
BACKUP_WORK_DIR="/var/tmp/conformia-backup"
BACKUP_ALLOW_DB_ONLY="false"       # ⚠️ développement uniquement
```

```bash
npm run backup                     # quotidienne
npm run backup -- --kind=MONTHLY   # archive mensuelle
```

Prérequis sur le serveur de sauvegarde : `pg_dump`, `tar`, et `rclone` si un
remote est employé. Le script nomme précisément l'outil manquant.

---

## Vérifier que ça marche

```sql
-- Les dix dernières exécutions
select started_at, kind, status, verified_at,
       pg_size_pretty(size_bytes) as taille, destination
from public.backup_runs order by started_at desc limit 10;
```

Une ligne saine porte `status = 'SUCCEEDED'` **et** `verified_at` non nul.

Pour éprouver l'alerte sans attendre 36 heures :

```sql
update public.backup_runs set finished_at = now() - interval '40 hours'
where id = (select max(id) from public.backup_runs where status = 'SUCCEEDED');
select public.notify_admins_of_stale_backup(36);
```

Le test d'intégration `tests/integration/exports-backups.test.ts` couvre ce
scénario, l'absence totale de sauvegarde, et la non-répétition horaire.

---

## Ce qui reste à faire à la mise en service

- [ ] Activer le PITR chez l'hébergeur (niveau 1).
- [ ] Choisir et monter le support de rapatriement (niveau 2).
- [ ] Générer `BACKUP_ENCRYPTION_KEY` et la déposer dans le coffre.
- [ ] Planifier `npm run backup` à 03 h 00 Alger — pg_cron le fait déjà si
      `pg_net` est disponible ; sinon, `cron` système.
- [ ] Configurer la rotation sur le support.
- [ ] **Exécuter une restauration d'épreuve** (voir `restore-procedure.md`) et
      consigner sa durée réelle.
