# Procédure de restauration

> Une sauvegarde jamais restaurée n'est pas une sauvegarde : c'est un fichier
> dont on espère qu'il est lisible.

Cette procédure est écrite pour être suivie par **quelqu'un qui n'a pas écrit
l'application**. Si une étape suppose un savoir non écrit ici, c'est un défaut de
ce document — le signaler.

**Durée totale estimée : 35 à 50 minutes** pour une base de quelques gigaoctets.
Reporter la durée réelle constatée en fin de document.

---

## Avant de commencer

| Il vous faut                            | Où le trouver                                              |
| --------------------------------------- | ---------------------------------------------------------- |
| L'archive `.tar.enc`                    | Support de rapatriement (`BACKUP_DESTINATION` ou le NAS)   |
| `BACKUP_ENCRYPTION_KEY`                 | **Coffre de l'entreprise.** Elle n'est pas avec l'archive. |
| Une base PostgreSQL vide et **jetable** | Voir étape 2                                               |
| `psql`, `pg_dump`, `tar`, Node 22+      | Poste ou serveur d'exploitation                            |

⚠️ **Ne restaurez jamais sur la base de production.** Le script refuse une cible
dont le nom ne contient pas `restore`, `test` ou `staging`, et n'accepte une
adresse locale que par exception. Ce refus est délibéré : il coûte une minute,
son absence coûterait l'entreprise.

---

## Étape 1 — Vérifier que l'archive est lisible _(2 min)_

**Avant tout le reste.** Cette étape n'écrit nulle part.

```bash
npm run restore -- --archive=/srv/backups/conformia-20260902T030000.tar.enc --verify-only
```

**Point de contrôle** — la sortie doit afficher :

```
ARCHIVE LISIBLE — déchiffrée, extraite, export présent.
Aucune écriture effectuée (--verify-only).
```

**Si le déchiffrement échoue** : soit la clé n'est pas celle qui a servi à
chiffrer, soit l'archive est corrompue. Le message le dit. Comparez l'empreinte
affichée avec `sha256` de la ligne correspondante :

```sql
select started_at, sha256, destination from public.backup_runs
where status = 'SUCCEEDED' order by started_at desc limit 5;
```

Empreintes différentes → l'archive a été altérée depuis le transfert. Prenez la
sauvegarde de la veille et signalez l'incident.

---

## Étape 2 — Préparer une base jetable _(3 min)_

```bash
createdb conformia_restore
# ou, en SQL :
# CREATE DATABASE conformia_restore;
```

**Point de contrôle** : `psql "postgresql://…/conformia_restore" -c '\dt'` répond
sans erreur et ne liste aucune table.

---

## Étape 3 — Restaurer _(15 à 30 min selon le volume)_

```bash
npm run restore -- \
  --archive=/srv/backups/conformia-20260902T030000.tar.enc \
  --target=postgresql://postgres:…@127.0.0.1:5432/conformia_restore \
  --storage=/srv/restore/storage
```

Le script enchaîne : empreinte → déchiffrement → extraction → `psql
--single-transaction` → contrôles.

⚠️ `--single-transaction` : la restauration réussit **entièrement** ou ne laisse
**rien**. Une base à moitié restaurée est le pire résultat possible — elle a
l'air de fonctionner.

**Point de contrôle** — la sortie se termine par un tableau de comptages :

```
RESTAURATION TERMINÉE
  durée : 412 s
  obligation_types                 23
  obligation_occurrences          846
  documents                       391
  profiles                         14
  user_roles                       17
  audit_log                     12470
  occurrence_transitions         2103
```

**Toute table à 0 fait échouer le script** avec le code de sortie 1. Une base
restaurée dont une table métier est vide n'est pas une restauration réussie.

---

## Étape 4 — Comparer à la production _(5 min)_

Les comptages doivent être **cohérents avec la production à la date de la
sauvegarde**, pas identiques à aujourd'hui.

```sql
-- Sur la base restaurée ET sur la production
select 'obligation_occurrences' as t, count(*) from public.obligation_occurrences
union all select 'documents', count(*) from public.documents
union all select 'audit_log', count(*) from public.audit_log;
```

**Point de contrôle** : l'écart s'explique par l'activité depuis la sauvegarde.
Un écart de plusieurs milliers de lignes sur une nuit ne s'explique pas — arrêtez
et cherchez.

---

## Étape 5 — Vérifier des pièces réelles _(5 min)_

La base peut être parfaite et les documents absents. C'est le scénario le plus
courant, et le plus coûteux.

```bash
# Combien de fichiers ont été restaurés ?
find /srv/restore/storage -type f | wc -l
```

Comparez à :

```sql
select count(*) from public.documents where deleted_at is null;
```

Puis vérifiez **l'intégrité de trois pièces au hasard** : le chemin de stockage
est dans `documents.storage_path`, l'empreinte attendue dans `documents.sha256`.

```bash
sha256sum /srv/restore/storage/<storage_path>
```

**Point de contrôle** : les trois empreintes correspondent. Si l'une diverge, la
pièce a été altérée **avant** la sauvegarde — c'est un incident d'intégrité
documentaire, pas de restauration ; le contrôle mensuel d'intégrité aurait dû le
signaler.

---

## Étape 6 — Consigner _(2 min)_

```sql
select public.start_restore_test(<id de la ligne backup_runs>);
-- puis, une fois les contrôles faits :
select public.finish_restore_test(
  <id rendu ci-dessus>, 'PASSED',
  '{"obligation_occurrences": 846, "documents": 391}'::jsonb,
  3, 3, '[]'::jsonb, 412,
  'Restauration d''épreuve manuelle, conforme.');
```

La tâche mensuelle le fait seule (voir plus bas) ; en restauration manuelle,
c'est à vous. Une restauration réussie et non consignée ne prouve rien le jour
où on demande la dernière date d'épreuve.

---

## Étape 7 — Détruire la base d'épreuve _(1 min)_

```bash
dropdb conformia_restore
rm -rf /srv/restore/storage .restore-work
```

⚠️ Elle contient **toutes** les données de l'entreprise, sans les protections de
la production. La laisser traîner annule le bénéfice de tout le reste.

---

## Restauration réelle après sinistre

Même procédure, à trois différences près :

1. **Étape 1 obligatoire et sur plusieurs archives** : vérifiez la plus récente
   _et_ celle de la veille avant de choisir.
2. La cible est la nouvelle base de production. Le garde-fou de nom la refusera :
   passez par une base `…_restore`, contrôlez, **puis** renommez. Ne modifiez pas
   le garde-fou.
3. Après restauration, régénérer les types (`npm run db:types`) et relancer les
   migrations postérieures à la sauvegarde (`npm run db:migrate`).

**Le stockage se restaure avant de rouvrir l'application.** Des utilisateurs sur
une base sans pièces déposent des doublons.

---

## Épreuve mensuelle automatique

`npm run restore:test` restaure la dernière sauvegarde dans une base jetable,
compte les tables principales, vérifie l'intégrité d'un échantillon de documents,
et écrit son verdict dans `restore_tests`.

Planifiée le 1er de chaque mois à 04 h 00 Alger.

```sql
select started_at, status, duration_seconds, documents_verified, documents_sampled, failures
from public.restore_tests order by started_at desc limit 12;
```

Une colonne `failures` vide (`[]`) et un statut `PASSED` : la dernière sauvegarde
est restaurable, à cette date. C'est la seule affirmation que ce projet accepte
de faire sur ses sauvegardes.

---

## Durées réelles constatées

| Date                                | Volume base | Volume stockage | Durée | Par |
| ----------------------------------- | ----------- | --------------- | ----- | --- |
| _(à remplir à la première épreuve)_ |             |                 |       |     |
