# Retour arrière des migrations

⚠️ **Une migration sans retour arrière documenté est une décision irréversible
prise sans le dire.** Ce fichier existe pour que la question « peut-on revenir ? »
ait une réponse **avant** l'incident, et non pendant.

**Règle de tenue :** toute migration nouvelle ajoute sa ligne ici, **dans le même
commit**. Une ligne manquante se remarque en revue ; une ligne écrite trois
semaines plus tard est écrite de mémoire.

---

## Les trois natures de retour arrière

Toutes les migrations ne se défont pas de la même façon, et confondre les trois
est la meilleure façon de perdre des données en croyant les sauver.

| Nature                       | Ce que cela veut dire                                                                  | Comment on revient                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Réversible**               | Objets ajoutés, rien de détruit.                                                       | On les supprime. Aucune donnée perdue.                                        |
| **Réversible avec perte**    | Colonne, table ou ligne supprimée, ou réécrite.                                        | On restaure depuis la sauvegarde. La perte est **ce qui a été écrit depuis**. |
| **Irréversible en pratique** | Le retour arrière casserait le code déployé, ou l'information d'origine n'existe plus. | On ne revient pas : on corrige **en avant**, par une migration suivante.      |

⚠️ **« Irréversible » ne veut pas dire « dangereux ».** Cela veut dire que le
plan de secours est un correctif, pas un retour — et qu'il faut donc l'avoir
répété en pré-production.

---

## Avant tout retour arrière — sans exception

```bash
npm run backup      # même si « ça ne prendra qu'une minute »
```

Un retour arrière est une écriture. Une écriture non sauvegardée est un pari.

---

## Le tableau

| #    | Migration                        | Nature           | Retour arrière                                                                                                                                                                                                                                                                                        |
| ---- | -------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0001 | `core_schema`                    | **Irréversible** | Le socle : entités, domaines, obligations, occurrences. Défaire, c'est vider la base. Aucun retour — restauration complète.                                                                                                                                                                           |
| 0002 | `identity_rls`                   | **Irréversible** | Rôles, permissions, RLS. Les retirer ouvrirait toutes les tables. Correction en avant, jamais en arrière.                                                                                                                                                                                             |
| 0003 | `audit_documents`                | **Irréversible** | `audit_log` est append-only et partitionné. Le défaire détruirait la traçabilité — c'est-à-dire la raison d'être du produit.                                                                                                                                                                          |
| 0004 | `auth_hardening`                 | Réversible       | `drop` des triggers de durcissement et de `auth_attempts`. ⚠️ Rouvre la porte au bourrage de mots de passe : à ne faire qu'en pré-production.                                                                                                                                                         |
| 0005 | `navigation_search`              | Réversible       | `drop function global_search`, `drop` des index de recherche. Aucune donnée métier touchée.                                                                                                                                                                                                           |
| 0006 | `obligations_module`             | **Avec perte**   | Colonnes du référentiel. Les supprimer perd les règles d'échéance saisies. Restauration.                                                                                                                                                                                                              |
| 0007 | `occurrence_workspace`           | Réversible       | `drop` des vues d'espace de travail et des statistiques. Recalculables.                                                                                                                                                                                                                               |
| 0008 | `occurrence_detail`              | **Avec perte**   | Commentaires et listes de contrôle. Leur suppression perd le travail des utilisateurs.                                                                                                                                                                                                                |
| 0009 | `documents_module`               | **Irréversible** | Le stockage contient des pièces réelles ; la base porte leurs empreintes. Défaire séparerait les deux.                                                                                                                                                                                                |
| 0010 | `workflow`                       | **Irréversible** | Machine à états et immuabilité des archives. Sans elle, un dossier archivé redevient modifiable — la garantie la plus forte du produit.                                                                                                                                                               |
| 0011 | `dashboard_admin`                | Réversible       | `drop` des vues de tableau de bord et de la garde de désactivation.                                                                                                                                                                                                                                   |
| 0012 | `validation_queue_scale`         | Réversible       | `drop` des index de la file. ⚠️ Le seul effet est une file lente : c'est de la performance, pas de la donnée.                                                                                                                                                                                         |
| 0013 | `generation_engine`              | Réversible       | `drop` des fonctions de génération. Les occurrences déjà créées demeurent.                                                                                                                                                                                                                            |
| 0014 | `notifications`                  | **Avec perte**   | Règles, escalades, file d'envoi. Perdre `notifications` perd l'historique des alertes — et la déduplication avec lui : les alertes déjà envoyées repartiraient.                                                                                                                                       |
| 0015 | `exports_backups`                | Réversible       | `drop` de `export_runs` et `backup_runs`. ⚠️ Perd l'historique qui prouve **quand** on a sauvegardé — au moment précis où on en aurait besoin.                                                                                                                                                        |
| 0016 | `observability`                  | Réversible       | `drop` de `job_runs` et des verrous. ⚠️ Aveugle la supervision : à ne faire qu'accompagné d'un retour arrière applicatif.                                                                                                                                                                             |
| 0017 | `rate_limit`                     | Réversible       | `drop` des compteurs. Rouvre les écritures sans limite.                                                                                                                                                                                                                                               |
| 0018 | `assignment_registers`           | **Avec perte**   | Registres de commerce et triade d'affectation. Les registres saisis sont des données réelles d'entreprise.                                                                                                                                                                                            |
| 0019 | `authorization_model`            | **Irréversible** | Matrice de rôles refondue, 92 politiques réécrites, `domain_id` dénormalisé. Revenir en arrière restaurerait des politiques que le code ne connaît plus.                                                                                                                                              |
| 0020 | `registers_assignments`          | Réversible       | `drop` des vues et fonctions d'affectation ; les colonnes restent.                                                                                                                                                                                                                                    |
| 0021 | `assignment_ui`                  | Réversible       | `drop function reassign_occurrence_triad`, `documents_search` revient à sa forme de 0020. ⚠️ La valeur `REGISTERS` ajoutée à `export_kind` **ne se retire pas** : PostgreSQL ne supprime pas une valeur d'énumération. Elle demeure, inutilisée.                                                      |
| 0022 | `notification_triad`             | **Avec perte**   | Audiences et chaîne d'alerte. Les valeurs d'énumération ajoutées (`RESPONSIBLE`, `DEPUTY`, `SUPERVISOR`, `WHATSAPP`) **ne se retirent pas**. Le retour arrière consiste à redéfinir `notification_audience_members` et les règles, pas à défaire l'énumération.                                       |
| 0023 | `notification_recipient_filters` | Réversible       | Redéfinir `due_notification_candidates` dans sa forme 0022. ⚠️ **À ne pas faire** : c'est cette version qui rétablit la préférence de canal, le contrôle des comptes désactivés, l'écart des profils sans adresse et la révocation d'accès à `authenticated`. Revenir, c'est réintroduire les quatre. |

---

## Ce qui ne se défait jamais, quelle que soit la migration

Trois catégories, à connaître avant de promettre un retour arrière :

1. **Les valeurs d'énumération.** PostgreSQL n'a pas de `DROP VALUE`. Une valeur
   ajoutée reste. Le retour arrière consiste à cesser de l'employer, pas à la
   supprimer.
2. **Les partitions d'audit déjà écrites.** `audit_log` est append-only par
   trigger. Un retour arrière qui prétendrait les effacer échouerait — et c'est
   voulu.
3. **Les objets du stockage.** Une pièce déposée existe hors de la base. Défaire
   une migration ne la reprend pas ; restaurer une base sans restaurer le
   stockage donne une base qui référence des documents disparus. C'est pourquoi
   `scripts/backup.ts` **refuse** de s'exécuter sans `BACKUP_STORAGE_SOURCE`.

---

## Répéter avant d'en avoir besoin

Un retour arrière écrit et jamais exécuté est une hypothèse. En pré-production,
au moins une fois : appliquer la dernière migration, la défaire, vérifier que
l'application démarre encore. Ce qui casse à ce moment-là aurait cassé en
production, un jour de crise, avec quelqu'un qui attend.
