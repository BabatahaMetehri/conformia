# Modèle de données

91 tables, **toutes** avec RLS activée. Ce document donne la structure et, surtout,
les raisons — la forme exacte des colonnes vit dans `supabase/migrations/`.

## Les deux objets qui portent tout

### Obligation (`obligation_types`)

Décrite **une seule fois**. Elle porte ses règles, pas ses instances : périodicité,
mode de calcul d'échéance (`due_rule`, en `jsonb`), pièces requises, entité
responsable, base légale, criticité, nombre de niveaux de validation.

⚠️ **`due_rule` est de la donnée, pas du code.** Ajouter une obligation ne demande
aucun déploiement. Une règle qui ne s'exprime pas avec le modèle fait étendre le
modèle, jamais le code (CLAUDE.md §3.5).

### Occurrence (`obligation_occurrences`)

Instance datée, **générée automatiquement**. C'est l'objet de travail quotidien.
Jamais saisie à la main dans le flux nominal.

Unicité : `(entity_id, obligation_type_id, period_key)` — c'est ce qui rend la
génération rejouable sans produire de doublon.

⚠️ **Aucune colonne de montant, par décision arrêtée.** La plateforme suit la
DÉMARCHE, pas les chiffres. Ajouter un montant en ferait un outil comptable, avec les
obligations de justesse et de rapprochement qui vont avec.

Deux échéances, toujours :

- `legal_due_date` — celle de l'administration ;
- `internal_due_date` — celle de l'équipe, en avance de quelques **jours ouvrés**
  selon la criticité (7 / 5 / 3 / 0). Les alertes portent sur l'échéance **interne** :
  alerter à la date légale, c'est alerter trop tard.

## Cycle de vie

```
TODO → IN_PROGRESS → PENDING_VALIDATION → VALIDATED → SUBMITTED → ARCHIVED
                            │
                            ├─→ REJECTED ──→ IN_PROGRESS
                            └─→ NOT_APPLICABLE
```

⚠️ **Les transitions sont des DONNÉES**, dans `status_transition_rules` — pas un
`switch`. Toute transition passe par `evaluate_transition()` puis
`apply_occurrence_transition()`, qui vérifient dans cet ordre :

1. la transition est permise depuis l'état courant ;
2. l'acteur détient la permission ;
3. les pièces obligatoires sont présentes (`occurrence_missing_items()`) ;
4. le préparateur n'est pas le valideur ;
5. la référence d'organisme et la preuve de dépôt existent, si l'obligation les exige ;
6. le motif de retard est fourni au-delà de l'échéance légale.

`apply_occurrence_transition()` rend `APPLIED` quand elle a agi — et non `ALLOWED`,
qui est le verdict d'`evaluate_transition()`. Les deux mots désignent deux choses.

**Verrouillage optimiste** : la colonne `version` s'incrémente à chaque transition.
Deux validations concurrentes ne peuvent pas aboutir toutes les deux.

## Documents

`documents` porte l'empreinte `sha256`, la version, le lien `supersedes_id` vers la
version précédente, et `checklist_item_id` vers la ligne de dossier qu'il satisfait.

⚠️ **Le rattachement fait la complétude.** Une pièce obligatoire est fournie quand un
document VIVANT lui est rattaché — aucune case à cocher n'entre dans ce calcul, et
`is_checked` n'est plus qu'une dérivation du dépôt.

⚠️ **`authenticated` n'a AUCUN droit d'écriture direct sur `documents`.** Tout dépôt
passe par `confirm_document_upload()`, `security definer`, qui vérifie le billet,
l'empreinte et l'occurrence. C'est une garantie du modèle : elle se constate en
essayant.

`document_access_log` (partitionnée par mois) enregistre chaque consultation. La
trace précède l'émission de l'URL signée, dans la même transaction.

## Audit

`audit_log`, partitionnée par mois, **append-only garanti par trigger** — aucun
`UPDATE`, aucun `DELETE`.

Chaque ligne porte : acteur, courriel, action, table, identifiant, état avant, état
après, champs modifiés, horodatage UTC, adresse IP, et depuis 0016 l'**identifiant de
corrélation** de la requête.

Colonnes sensibles masquées à l'écriture (`audit_redacted_columns`) : mots de passe,
jetons, secrets.

⚠️ **Le trigger ne capture aucune exception.** Si le journal ne peut pas s'écrire, la
transaction métier est annulée. Un système de conformité qui perd sa traçabilité en
silence vaut moins que pas de système du tout.

## Identités et droits

```
profiles ──< user_roles >── roles ──< role_permissions >── permissions
                 │
                 └── domains   (NULL = tous les domaines)
```

`validation_delegations` permet à un valideur de déléguer temporairement ses droits —
avec dates de début et de fin, révocation, et trace dans l'audit
(`audit_log.on_behalf_of_id`). Elle existe pour remplacer la pratique réelle qu'elle
rend inutile : le prêt de mot de passe pendant les congés.

## Exploitation

| Table             | Rôle                                                                |
| ----------------- | ------------------------------------------------------------------- |
| `job_runs`        | une ligne par exécution planifiée, y compris celles sans effet      |
| `backup_runs`     | journal des sauvegardes, avec empreinte et destination              |
| `restore_tests`   | verdict des épreuves de restauration mensuelles                     |
| `export_runs`     | traçabilité des exports — qui a extrait quoi, quand                 |
| `notifications`   | file d'envoi ET centre de notifications de l'utilisateur            |
| `rate_limit_hits` | fenêtre glissante de la limitation de débit, purgée au fil de l'eau |
| `auth_attempts`   | tentatives de connexion, pour la limitation par courriel et par IP  |
| `holidays`        | jours fériés algériens — **donnée**, jamais une table en dur        |

⚠️ `job_runs` enregistre aussi les exécutions **sans effet** : un silence ne se
distingue pas d'une panne. La vue `job_health` va plus loin — elle part de la liste
des travaux ATTENDUS, si bien qu'un planificateur arrêté rend `NEVER_RAN` ou `STALE`
au lieu de ne rien rendre du tout.

## Dates : la règle qui ne souffre pas d'exception

- **Stockage** : `timestamptz`, toujours en UTC.
- **Conversion** : à la frontière seulement — affichage, calcul d'échéance, bornes de
  période — et toujours vers `Africa/Algiers` (UTC+1, **sans** heure d'été).
- **Week-end algérien : vendredi et samedi.** Pas samedi-dimanche. Toute la logique de
  jours ouvrés en dépend.
- « Au 20 du mois » signifie **fin de journée à Alger**, pas à UTC.

## Conventions

- Suppression physique **interdite** sur les données métier : `deleted_at`, filtré au
  niveau RLS.
- `SELECT *` interdit dans le code applicatif : colonnes explicites, toujours.
- `src/types/database.types.ts` est **généré** (`npm run db:types`) et ne s'édite
  jamais à la main. Toute modification de schéma est suivie de sa régénération **dans
  le même commit**.
- Une migration appliquée est **immuable**. On en écrit une nouvelle.
