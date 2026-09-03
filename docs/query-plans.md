# Plans d'exécution

> Relevé le 2026-09-03 par `node scripts/query-plans.ts`, sur la base locale.
> **Régénérer ce fichier plutôt que le modifier à la main.**

## Comment lire ce document

Chaque plan a été obtenu **sous session utilisateur**, `set local role authenticated`
et revendications JWT posées — donc **RLS appliquée**. C'est essentiel : les
politiques de `obligation_occurrences` appellent des fonctions `security definer`
que PostgreSQL n'inline pas. Un plan relevé en `postgres` ignore ce coût et donne
une image fausse, plus rapide d'un ou deux ordres de grandeur.

Un temps d'exécution supérieur à **200 ms** est signalé. Sur la base
locale, les volumes sont ceux du jeu de développement : ces chiffres servent à
comparer les plans entre eux et à repérer un balayage séquentiel là où un index
existe, pas à prédire les temps de production.

<!-- TENUE-EN-CHARGE:DEBUT -->
## Tenue en charge — correction du défaut D-1

> Relevé le **2026-09-03**, à la main, sur **50 000 occurrences** dont **10 000 en
> attente de validation**, réparties sur 20 obligations et **deux préparateurs**.
> Lu par un compte **SUPERVISEUR de portée FISCAL**, `set role authenticated` et
> revendications JWT posées — donc RLS appliquée.
>
> ⚠️ **Ce bloc est tenu à la main et préservé par `scripts/query-plans.ts`.** Il
> ne se régénère pas : la colonne « avant » n'existe plus une fois le correctif
> appliqué.

### Ce qui a été mesuré

Les deux colonnes ont été relevées sur **le même jeu de données, dans le même
état de table** — le correctif a été appliqué en place entre les deux passages.
Les deux mesures portent donc le même ballonnement et la même distribution : la
comparaison ne doit rien à un rechargement plus favorable.

Chaque requête a été lue par `EXPLAIN (ANALYZE, BUFFERS)`. La file rend **5 000
dossiers avant comme après** : c'est la même réponse, obtenue autrement.

| Requête | Avant | Après | Accès tampon avant | après |
| --- | ---: | ---: | ---: | ---: |
| **File de validation** (`select *`) | **14 257 ms** | **57 ms** | **463 633** | **4 115** |
| File de validation (`count`) | 11 914 ms | 14 ms | 459 992 | 1 693 |
| **Pastille de navigation** | **4 043 ms** | **14 ms** | **131 542** | **1 699** |
| Échéancier — première page | 9,6 ms | 1,0 ms | 453 | 90 |
| Agrégats du tableau de bord | 1,6 ms | 1,2 ms | 119 | 125 |
| Bandeau d'alertes | 11,7 ms | 12,3 ms | 2 954 | 3 171 |

Le bandeau d'alertes est la seule ligne qui ne progresse pas. Mesuré cinq fois de
suite, il se stabilise à **8,7–9,3 ms** : les 12,3 ms sont un premier passage
sous instrumentation `EXPLAIN ANALYZE`, pas une dégradation. Il n'y avait rien à
y gagner — il interroge les tables vives sur un prédicat déjà indexé.

### La cause, telle que le plan la donnait

```
Filter: ((deleted_at IS NULL) AND is_active_user()
         AND (has_permission_in_domain('occurrence.read',
                obligation_domain_of_type(obligation_type_id))
              OR (owner_id = current_profile_id())
              OR (validator_id = current_profile_id()))
         AND (ot.domain_id = ANY (domains_with_permission('occurrence.validate'))))
Rows Removed by Filter: 2000
Heap Blocks: exact=15696
```

Tout ce qui est dans un `Filter` est évalué **une fois par ligne examinée**.
Trois défauts distincts s'y superposaient :

1. **`obligation_domain_of_type(obligation_type_id)`** rouvrait `obligation_types`
   pour chaque dossier, alors que le domaine d'un dossier ne change pas en cours
   de requête.
2. **Aucun appel n'était enveloppé dans un sous-select.** Y compris
   `domains_with_permission(...)`, introduite en 0012 précisément pour n'être
   évaluée qu'une fois : la migration 0012 avait corrigé la *forme* sans corriger
   le *nombre d'évaluations*.
3. **Les fonctions étaient `PARALLEL UNSAFE`** — le défaut de PostgreSQL — ce qui
   interdit tout plan parallèle sur la requête entière.

### Le plan après correctif

```
Aggregate
  InitPlan 1  ->  Result (actual rows=1 loops=1)
  InitPlan 2  ->  Result (never executed)
  ...
  ->  Hash Join
        ->  Bitmap Heap Scan on obligation_occurrences oc
              Filter: ((InitPlan 22).col1 AND (deleted_at IS NULL)
                       AND ((domain_id = ANY ((InitPlan 23).col1))
                            OR (owner_id = (InitPlan 24).col1)
                            OR (deputy_id = (InitPlan 25).col1)
                            OR (validator_id = (InitPlan 26).col1)))
```

Chaque terme d'habilitation est devenu un **`InitPlan`**, `rows=1 loops=1` :
évalué une seule fois pour toute la requête. Plusieurs sont `never executed` — le
filet DIRECTION ne s'ouvre pas pour un compte qui n'en relève pas. La boucle
imbriquée sur `obligation_types` est devenue une jointure de hachage.

### Les trois corrections

| Cause | Correction | Où |
| --- | --- | --- |
| Domaine remonté par ligne | Colonne `obligation_occurrences.domain_id`, posée et réalignée par trigger | 0019 §2 |
| Fonction évaluée par ligne | `X = any ((select accessible_domains_array(p))::uuid[])` | 0019 §3, §5 |
| Plan parallèle interdit | `PARALLEL SAFE` sur les 15 fonctions d'habilitation | 0019 §3.2 |

⚠️ Le transtypage `::uuid[]` est **portant**. `any` a deux formes, choisies sur la
syntaxe : `any (sous-select)` est la forme ensembliste, qui compare la colonne aux
*lignes* du sous-select — soit un `uuid` à un `uuid[]`, et un refus à la création
de la politique. Le transtypage en fait une expression, donc la forme tableau,
tout en la laissant non corrélée.

### Ce qui garde la correction

`tests/integration/dashboard-performance.test.ts`, marqué `@slow`, reconstruit
les 50 000 dossiers et vérifie **deux** budgets : moins de 200 ms, et moins de
10 000 accès tampon. La seconde assertion est la plus utile — le temps dépend de
la machine, les accès tampon non, et un appel qui cesserait d'être enveloppé s'y
verrait avant que le chronomètre ne s'en émeuve.

`tests/integration/authorization-model.test.ts` vérifie **structurellement**
qu'aucune politique ne porte d'appel d'habilitation non enveloppé, et que les
quinze fonctions restent `STABLE PARALLEL SAFE`.

<!-- TENUE-EN-CHARGE:FIN -->

## Synthèse

| Requête | Planification | Exécution | Balayages séquentiels |
| --- | ---: | ---: | ---: |
| Échéancier — première page | 1.80 ms | 0.30 ms | 4 |
| Échéancier — filtré par domaine et statut | 0.60 ms | 0.08 ms | 4 |
| Échéancier — page suivante (curseur) | 0.55 ms | 0.08 ms | 4 |
| Mes tâches | 0.23 ms | 0.02 ms | 1 |
| File de validation | 0.13 ms | 0.03 ms | 1 |
| Fiche d'un dossier — liste de contrôle | 0.62 ms | 0.05 ms | 4 |
| Documents — liste filtrée | 0.17 ms | 0.03 ms | 2 |
| Référentiel des obligations | 0.06 ms | 0.03 ms | 1 |
| Centre de notifications | 0.30 ms | 0.02 ms | 1 |
| Journal d'audit — dernière page | 4.09 ms | 1.27 ms | 0 |

Aucune requête au-dessus de 200 ms sur ce jeu de données.

## Volumes au moment du relevé

| Table | Lignes (estimation) | Taille totale |
| --- | ---: | ---: |
| `audit_log_2026m09` | 21679 | 31 MB |
| `obligation_occurrences` | 0 | 24 MB |
| `occurrence_transitions` | 0 | 1472 kB |
| `documents` | 0 | 200 kB |
| `notifications` | 0 | 168 kB |
| `obligation_types` | 0 | 152 kB |
| `user_roles` | 1 | 112 kB |
| `document_upload_tickets` | 0 | 104 kB |
| `profiles` | 8 | 96 kB |
| `occurrence_checklist_items` | 0 | 88 kB |
| `commercial_registers` | -1 | 80 kB |
| `export_runs` | -1 | 80 kB |
| `document_integrity_checks` | -1 | 80 kB |
| `calendar_feed_tokens` | 2 | 72 kB |
| `auth_attempts` | -1 | 64 kB |

## Les dix requêtes les plus fréquentes

Relevé de `pg_stat_statements`, tel quel. Les requêtes y sont **normalisées**
(paramètres remplacés par `$1`) : elles ne sont pas rejouables telles quelles,
d'où les sondes explicites ci-dessus.

| Appels | Moyenne | Total | Requête |
| ---: | ---: | ---: | --- |
| 1000 | 0.02 ms | 21.8 ms | `select set_config('search_path', $1, true), set_config($2, $3, true), set_config('role', $4, true), set_config('request.jwt.claims', $5, true), set_config('requ` |
| 434 | 0.01 ms | 5.4 ms | `select set_config('search_path', $1, true), set_config('role', $2, true), set_config('request.jwt.claims', $3, true), set_config('request.method', $4, true), se` |
| 394 | 0.01 ms | 2.7 ms | `set local role authenticated` |
| 242 | 0.00 ms | 0.2 ms | `rollback` |
| 181 | 0.98 ms | 177.0 ms | `WITH pgrst_source AS (SELECT pgrst_call.pgrst_scalar FROM (SELECT $1 AS json_data) pgrst_payload, LATERAL (SELECT "p_obligation_type_id", "p_period_key", "p_per` |
| 89 | 0.30 ms | 26.5 ms | `WITH pgrst_source AS (SELECT pgrst_call.pgrst_scalar FROM (SELECT $1 AS json_data) pgrst_payload, LATERAL (SELECT "p_user_id" FROM json_to_record(pgrst_payload.` |
| 89 | 0.50 ms | 44.7 ms | `WITH pgrst_source AS (SELECT pgrst_call.pgrst_scalar FROM (SELECT $1 AS json_data) pgrst_payload, LATERAL (SELECT "p_user_id" FROM json_to_record(pgrst_payload.` |
| 69 | 1.26 ms | 86.7 ms | `select public.evaluate_transition($1, $2::public.occurrence_status, $3) as v` |
| 68 | 1.09 ms | 74.0 ms | `WITH pgrst_source AS (SELECT pgrst_call.pgrst_scalar FROM (SELECT $1 AS json_data) pgrst_payload, LATERAL (SELECT "p_ip" FROM json_to_record(pgrst_payload.json_` |
| 68 | 0.01 ms | 0.7 ms | `SELECT current_setting($1)::integer, current_setting($2), version()` |

## Ce que ce relevé apprend

Trois constats, dans l'ordre du coût mesuré.

**1. `navigation_counters()` est le point le plus cher de l'application.**
Appelée à chaque rendu de page — elle alimente les compteurs de la barre
latérale — elle domine le temps total cumulé alors qu'aucune requête d'écran
n'approche sa moyenne. C'est le premier endroit à regarder si les pages
ralentissent, avant tout écran métier.

**2. Le contexte d'authentification coûte quatre allers-retours par rendu.**
`profiles`, `user_roles`, `role_permissions` et `validation_delegations` sont
lues séparément. Les regrouper en une fonction unique est faisable et le gain
serait mesurable — mais ce n'est PAS fait ici : une tentative antérieure de
factoriser des fonctions `security definer` de la RLS a fait passer un compteur
de 92 ms à plus de 30 s, parce que PostgreSQL cesse alors d'inliner. Toute
reprise de ce point doit être mesurée AVANT d'être adoptée, pas après.

**3. `session_gates` est appelée sur chaque requête, préchargements compris.**
C'est le prix de la garde du middleware, et il est assumé : la porte se referme
sur chaque requête ou elle ne sert à rien. Sa moyenne reste basse ; c'est le
nombre d'appels qui la place en tête, pas son coût unitaire.

Aucune de ces observations n'a donné lieu à une réécriture dans cette phase.
Les temps mesurés — quelques millisecondes — sont sans commune mesure avec le
volume réel de la plateforme (quelques dizaines d'utilisateurs), et changer un
chemin d'accès sans un gain démontré ferait courir un risque supérieur au
bénéfice. Ce document existe pour que la décision soit reprise sur des chiffres,
le jour où elle se posera.

## Index jamais employés

⚠️ **Sur une base de développement, ce tableau est presque vide de sens** : les
tables comptent quelques dizaines de lignes, et le planificateur préfère alors
un balayage séquentiel à tout index, si pertinent soit-il. À relire sur une base
chargée — c'est là seulement qu'un `idx_scan = 0` devient une question.

Un index inutilisé coûte à chaque écriture et ne rapporte rien en lecture.
**Attention à la lecture** : `idx_scan = 0` sur une base de développement peut
simplement signifier que l'écran correspondant n'a pas été ouvert. Ce tableau
sert à poser la question, pas à décider seul d'une suppression.

| Table | Index | Balayages | Taille |
| --- | --- | ---: | ---: |
| `obligation_occurrences` | `obligation_occurrences_search_idx` | 0 | 3720 kB |
| `obligation_occurrences` | `obligation_occurrences_entity_domain_status_idx` | 0 | 952 kB |
| `audit_log_2026m09` | `audit_log_2026m09_pkey` | 0 | 704 kB |
| `occurrence_transitions` | `occurrence_transitions_pkey` | 0 | 240 kB |
| `audit_log_2026m09` | `audit_log_2026m09_actor_id_occurred_at_idx` | 0 | 208 kB |
| `audit_log_2026m09` | `audit_log_2026m09_occurred_at_idx` | 0 | 200 kB |
| `obligation_types` | `obligation_types_search_idx` | 0 | 48 kB |
| `documents` | `documents_search_idx` | 0 | 24 kB |
| `user_absences` | `user_absences_active_idx` | 0 | 16 kB |
| `notifications` | `notifications_outbox_idx` | 0 | 16 kB |
| `escalation_policies` | `escalation_policies_lookup_idx` | 0 | 16 kB |
| `notification_rules` | `notification_rules_lookup_idx` | 0 | 16 kB |
| `obligation_types` | `obligation_types_entity_domain_idx` | 0 | 16 kB |
| `user_absences` | `user_absences_pkey` | 0 | 16 kB |
| `entities` | `entities_code_key` | 0 | 16 kB |
| `job_runs` | `job_runs_name_idx` | 0 | 16 kB |
| `dashboard_workload` | `dashboard_workload_key_idx` | 0 | 16 kB |
| `transition_notifications` | `transition_notifications_pkey` | 0 | 16 kB |
| `job_runs` | `job_runs_unfinished_idx` | 0 | 16 kB |
| `holidays` | `holidays_pkey` | 0 | 16 kB |
| `occurrence_stats` | `occurrence_stats_key_idx` | 0 | 16 kB |
| `backup_runs` | `backup_runs_recent_idx` | 0 | 16 kB |
| `dashboard_health` | `dashboard_health_key_idx` | 0 | 16 kB |
| `user_invitations` | `user_invitations_pending_idx` | 0 | 16 kB |
| `dashboard_upcoming_load` | `dashboard_upcoming_load_key_idx` | 0 | 16 kB |
| `user_invitations` | `user_invitations_active_email_idx` | 0 | 16 kB |
| `document_upload_tickets` | `document_upload_tickets_storage_path_key` | 0 | 16 kB |
| `dashboard_compliance_monthly` | `dashboard_compliance_monthly_key_idx` | 0 | 16 kB |
| `profiles` | `profiles_email_key` | 0 | 16 kB |
| `dashboard_late_reasons` | `dashboard_late_reasons_key_idx` | 0 | 16 kB |
| `export_runs` | `export_runs_recent_idx` | 0 | 16 kB |
| `profiles` | `profiles_ics_token_key` | 0 | 16 kB |
| `document_access_log_2026m09` | `document_access_log_2026m09_actor_id_created_at_idx` | 0 | 16 kB |
| `status_transition_rules` | `status_transition_rules_pkey` | 0 | 16 kB |
| `auth_attempts` | `auth_attempts_purge_idx` | 0 | 16 kB |
| `user_invitations` | `user_invitations_pkey` | 0 | 16 kB |
| `document_access_log_2026m09` | `document_access_log_2026m09_pkey` | 0 | 16 kB |
| `documents` | `documents_sha256_idx` | 0 | 16 kB |
| `auth_attempts` | `auth_attempts_pkey` | 0 | 16 kB |
| `document_integrity_checks` | `document_integrity_checks_run_idx` | 0 | 16 kB |

## Plans détaillés

### Échéancier — première page

La liste de travail quotidienne, triée par échéance interne.

```sql
select id, period_key, status, internal_due_date, legal_due_date
          from public.occurrence_list
          order by internal_due_date asc, id asc
          limit 25
```

```
Limit  (cost=176.18..176.20 rows=8 width=36) (actual time=0.032..0.035 rows=0 loops=1)
  Buffers: shared hit=7
  InitPlan 1
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 2
    ->  Result  (cost=0.00..0.26 rows=1 width=32) (never executed)
  InitPlan 3
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  InitPlan 4
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  InitPlan 5
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  ->  Sort  (cost=174.88..174.90 rows=8 width=36) (actual time=0.032..0.034 rows=0 loops=1)
        Sort Key: oc.internal_due_date, oc.id
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=7
        ->  Nested Loop Left Join  (cost=3.71..174.76 rows=8 width=36) (actual time=0.009..0.012 rows=0 loops=1)
              Buffers: shared hit=1
              ->  Nested Loop Left Join  (cost=2.80..76.74 rows=8 width=52) (actual time=0.009..0.010 rows=0 loops=1)
                    Buffers: shared hit=1
                    ->  Nested Loop Left Join  (cost=1.88..53.59 rows=8 width=68) (actual time=0.009..0.010 rows=0 loops=1)
                          Buffers: shared hit=1
                          ->  Nested Loop Left Join  (cost=1.46..37.58 rows=8 width=84) (actual time=0.009..0.009 rows=0 loops=1)
                                Buffers: shared hit=1
                                ->  Nested Loop  (cost=1.04..21.56 rows=8 width=100) (actual time=0.008..0.009 rows=0 loops=1)
                                      Buffers: shared hit=1
                                      ->  Seq Scan on obligation_occurrences oc  (cost=0.00..1.48 rows=8 width=84) (actual time=0.008..0.009 rows=0 loops=1)
                                            Filter: ((InitPlan 1).col1 AND (deleted_at IS NULL) AND ((domain_id = ANY ((InitPlan 2).col1)) OR (owner_id = (InitPlan 3).col1) OR (deputy_id = (InitPlan 4).col1) OR (validator_id = (InitPlan 5).col1)))
                                            Buffers: shared hit=1
                                      ->  Limit  (cost=1.04..2.49 rows=1 width=105) (never executed)
                                            InitPlan 6
                                              ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                                            InitPlan 7
                                              ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                                            InitPlan 8
                                              ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                                            InitPlan 9
                                              ->  Result  (cost=0.00..0.26 rows=1 width=32) (never executed)
                                            ->  Seq Scan on obligation_types ot  (cost=0.00..1.45 rows=1 width=105) (never executed)
                                                  Filter: ((InitPlan 6).col1 AND (id = oc.obligation_type_id) AND ((InitPlan 7).col1 OR ((InitPlan 8).col1 AND (domain_id = ANY ((InitPlan 9).col1)))))
                                ->  Memoize  (cost=0.42..8.45 rows=1 width=0) (never executed)
                                      Cache Key: ot.domain_id
                                      Cache Mode: binary
                                      ->  Subquery Scan on dom  (cost=0.41..8.44 rows=1 width=0) (never executed)
                                            ->  Limit  (cost=0.41..8.43 rows=1 width=64) (never executed)
                                                  InitPlan 10
                                                    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                                                  ->  Index Only Scan using domains_pkey on domains d  (cost=0.15..8.17 rows=1 width=64) (never executed)
                                                        Index Cond: (id = ot.domain_id)
                                                        Filter: (InitPlan 10).col1
                                                        Heap Fetches: 0
                          ->  Memoize  (cost=0.42..8.45 rows=1 width=0) (never executed)
                                Cache Key: ot.authority_id
                                Cache Mode: binary
                                ->  Subquery Scan on auth_org  (cost=0.41..8.44 rows=1 width=0) (never executed)
                                      ->  Limit  (cost=0.41..8.43 rows=1 width=32) (never executed)
                                            InitPlan 11
                                              ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                                            ->  Index Only Scan using authorities_pkey on authorities a  (cost=0.15..8.17 rows=1 width=32) (never executed)
                                                  Index Cond: (id = ot.authority_id)
                                                  Filter: (InitPlan 11).col1
                                                  Heap Fetches: 0
                    ->  Memoize  (cost=0.92..12.25 rows=1 width=0) (never executed)
                          Cache Key: oc.owner_id
                          Cache Mode: binary
                          ->  Subquery Scan on owner_profile  (cost=0.91..12.24 rows=1 width=0) (never executed)
                                ->  Limit  (cost=0.91..12.23 rows=1 width=32) (never executed)
                                      InitPlan 12
                                        ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                                      InitPlan 13
                                        ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                                      InitPlan 14
                                        ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                                      ->  Index Only Scan using profiles_pkey on profiles p  (cost=0.13..11.45 rows=1 width=32) (never executed)
                                            Index Cond: (id = oc.owner_id)
                                            Filter: ((InitPlan 12).col1 AND ((id = (InitPlan 13).col1) OR (InitPlan 14).col1 OR EXISTS(SubPlan 24)))
                                            Heap Fetches: 0
                                            SubPlan 24
                                              ->  Seq Scan on obligation_occurrences oc_1  (cost=2.34..4.26 rows=2 width=0) (never executed)
                                                    Filter: ((InitPlan 19).col1 AND ((owner_id = p.id) OR (deputy_id = p.id) OR (validator_id = p.id)) AND ((domain_id = ANY ((InitPlan 20).col1)) OR (owner_id = (InitPlan 21).col1) OR (deputy_id = (InitPlan 22).col1) OR (validator_id = (InitPlan 23).col1)) AND ((domain_id = ANY ((InitPlan 15).col1)) OR (owner_id = (InitPlan 16).col1) OR (deputy_id = (InitPlan 17).col1) OR (validator_id = (InitPlan 18).col1)))
                                                    InitPlan 15
                                                      ->  Result  (cost=0.00..0.26 rows=1 width=32) (never executed)
                                                    InitPlan 16
                                                      ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                                                    InitPlan 17
                                                      ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                                                    InitPlan 18
                                                      ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                                                    InitPlan 19
                                                      ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                                                    InitPlan 20
                                                      ->  Result  (cost=0.00..0.26 rows=1 width=32) (never executed)
                                                    InitPlan 21
                                                      ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                                                    InitPlan 22
                                                      ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                                                    InitPlan 23
                                                      ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
              ->  Limit  (cost=0.91..12.23 rows=1 width=32) (never executed)
                    InitPlan 25
                      ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                    InitPlan 26
                      ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                    InitPlan 27
                      ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                    ->  Index Only Scan using profiles_pkey on profiles p_1  (cost=0.13..11.45 rows=1 width=32) (never executed)
                          Index Cond: (id = oc.validator_id)
                          Filter: ((InitPlan 25).col1 AND ((id = (InitPlan 26).col1) OR (InitPlan 27).col1 OR EXISTS(SubPlan 37)))
                          Heap Fetches: 0
                          SubPlan 37
                            ->  Seq Scan on obligation_occurrences oc_2  (cost=2.34..4.26 rows=2 width=0) (never executed)
                                  Filter: ((InitPlan 32).col1 AND ((owner_id = p_1.id) OR (deputy_id = p_1.id) OR (validator_id = p_1.id)) AND ((domain_id = ANY ((InitPlan 33).col1)) OR (owner_id = (InitPlan 34).col1) OR (deputy_id = (InitPlan 35).col1) OR (validator_id = (InitPlan 36).col1)) AND ((domain_id = ANY ((InitPlan 28).col1)) OR (owner_id = (InitPlan 29).col1) OR (deputy_id = (InitPlan 30).col1) OR (validator_id = (InitPlan 31).col1)))
                                  InitPlan 28
                                    ->  Result  (cost=0.00..0.26 rows=1 width=32) (never executed)
                                  InitPlan 29
                                    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                                  InitPlan 30
                                    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                                  InitPlan 31
                                    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                                  InitPlan 32
                                    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                                  InitPlan 33
                                    ->  Result  (cost=0.00..0.26 rows=1 width=32) (never executed)
                                  InitPlan 34
                                    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                                  InitPlan 35
                                    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                                  InitPlan 36
                                    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
Planning:
  Buffers: shared hit=831
Planning Time: 1.799 ms
Execution Time: 0.302 ms
```

### Échéancier — filtré par domaine et statut

Le filtre le plus employé : un domaine, les dossiers non clos.

```sql
select id, period_key, status, internal_due_date
          from public.occurrence_list
          where status in ('TODO', 'IN_PROGRESS', 'PENDING_VALIDATION')
          order by internal_due_date asc, id asc
          limit 25
```

```
Limit  (cost=113.17..113.18 rows=4 width=32) (actual time=0.007..0.009 rows=0 loops=1)
  Buffers: shared hit=1
  InitPlan 1
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 2
    ->  Result  (cost=0.00..0.26 rows=1 width=32) (never executed)
  InitPlan 3
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  InitPlan 4
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  InitPlan 5
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  ->  Sort  (cost=111.87..111.88 rows=4 width=32) (actual time=0.007..0.008 rows=0 loops=1)
        Sort Key: oc.internal_due_date, oc.id
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=1
        ->  Nested Loop Left Join  (cost=3.71..111.83 rows=4 width=32) (actual time=0.004..0.005 rows=0 loops=1)
              Buffers: shared hit=1
              ->  Nested Loop Left Join  (cost=2.80..62.82 rows=4 width=48) (actual time=0.004..0.005 rows=0 loops=1)
                    Buffers: shared hit=1
                    ->  Nested Loop Left Join  (cost=1.88..41.30 rows=4 width=64) (actual time=0.004..0.005 rows=0 loops=1)
                          Buffers: shared hit=1
                          ->  Nested Loop Left Join  (cost=1.46..26.44 rows=4 width=80) (actual time=0.004..0.004 rows=0 loops=1)
                                Buffers: shared hit=1
                                ->  Nested Loop  (cost=1.04..11.58 rows=4 width=96) (actual time=0.004..0.004 rows=0 loops=1)
                                      Buffers: shared hit=1
                                      ->  Seq Scan on obligation_occurrences oc  (cost=0.00..1.54 rows=4 width=80) (actual time=0.003..0.004 rows=0 loops=1)
                                            Filter: ((InitPlan 1).col1 AND (deleted_at IS NULL) AND ((domain_id = ANY ((InitPlan 2).col1)) OR (owner_id = (InitPlan 3).col1) OR (deputy_id = (InitPlan 4).col1) OR (validator_id = (InitPlan 5).col1)) AND (status = ANY ('{TODO,IN_PROGRESS,PENDING_VALIDATION}'::occurrence_status[])))
                                            Buffers: shared hit=1
                                      ->  Limit  (cost=1.04..2.49 rows=1 width=105) (never executed)
                                            InitPlan 6
                                              ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                                            InitPlan 7
                                              ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                                            InitPlan 8
                                              ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                                            InitPlan 9
                                              ->  Result  (cost=0.00..0.26 rows=1 width=32) (never executed)
                                            ->  Seq Scan on obligation_types ot  (cost=0.00..1.45 rows=1 width=105) (never executed)
                                                  Filter: ((InitPlan 6).col1 AND (id = oc.obligation_type_id) AND ((InitPlan 7).col1 OR ((InitPlan 8).col1 AND (domain_id = ANY ((InitPlan 9).col1)))))
                                ->  Memoize  (cost=0.42..8.45 rows=1 width=0) (never executed)
                                      Cache Key: ot.domain_id
                                      Cache Mode: binary
                                      ->  Subquery Scan on dom  (cost=0.41..8.44 rows=1 width=0) (never executed)
                                            ->  Limit  (cost=0.41..8.43 rows=1 width=64) (never executed)
                                                  InitPlan 10
                                                    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                                                  ->  Index Only Scan using domains_pkey on domains d  (cost=0.15..8.17 rows=1 width=64) (never executed)
                                                        Index Cond: (id = ot.domain_id)
                                                        Filter: (InitPlan 10).col1
                                                        Heap Fetches: 0
                          ->  Memoize  (cost=0.42..8.45 rows=1 width=0) (never executed)
                                Cache Key: ot.authority_id
                                Cache Mode: binary
                                ->  Subquery Scan on auth_org  (cost=0.41..8.44 rows=1 width=0) (never executed)
                                      ->  Limit  (cost=0.41..8.43 rows=1 width=32) (never executed)
                                            InitPlan 11
                                              ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                                            ->  Index Only Scan using authorities_pkey on authorities a  (cost=0.15..8.17 rows=1 width=32) (never executed)
                                                  Index Cond: (id = ot.authority_id)
                                                  Filter: (InitPlan 11).col1
                                                  Heap Fetches: 0
                    ->  Memoize  (cost=0.92..12.25 rows=1 width=0) (never executed)
                          Cache Key: oc.owner_id
                          Cache Mode: binary
                          ->  Subquery Scan on owner_profile  (cost=0.91..12.24 rows=1 width=0) (never executed)
                                ->  Limit  (cost=0.91..12.23 rows=1 width=32) (never executed)
                                      InitPlan 12
                                        ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                                      InitPlan 13
                                        ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                                      InitPlan 14
                                        ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                                      ->  Index Only Scan using profiles_pkey on profiles p  (cost=0.13..11.45 rows=1 width=32) (never executed)
                                            Index Cond: (id = oc.owner_id)
                                            Filter: ((InitPlan 12).col1 AND ((id = (InitPlan 13).col1) OR (InitPlan 14).col1 OR EXISTS(SubPlan 24)))
                                            Heap Fetches: 0
                                            SubPlan 24
                                              ->  Seq Scan on obligation_occurrences oc_1  (cost=2.34..4.26 rows=2 width=0) (never executed)
                                                    Filter: ((InitPlan 19).col1 AND ((owner_id = p.id) OR (deputy_id = p.id) OR (validator_id = p.id)) AND ((domain_id = ANY ((InitPlan 20).col1)) OR (owner_id = (InitPlan 21).col1) OR (deputy_id = (InitPlan 22).col1) OR (validator_id = (InitPlan 23).col1)) AND ((domain_id = ANY ((InitPlan 15).col1)) OR (owner_id = (InitPlan 16).col1) OR (deputy_id = (InitPlan 17).col1) OR (validator_id = (InitPlan 18).col1)))
                                                    InitPlan 15
                                                      ->  Result  (cost=0.00..0.26 rows=1 width=32) (never executed)
                                                    InitPlan 16
                                                      ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                                                    InitPlan 17
                                                      ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                                                    InitPlan 18
                                                      ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                                                    InitPlan 19
                                                      ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                                                    InitPlan 20
                                                      ->  Result  (cost=0.00..0.26 rows=1 width=32) (never executed)
                                                    InitPlan 21
                                                      ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                                                    InitPlan 22
                                                      ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                                                    InitPlan 23
                                                      ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
              ->  Limit  (cost=0.91..12.23 rows=1 width=32) (never executed)
                    InitPlan 25
                      ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                    InitPlan 26
                      ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                    InitPlan 27
                      ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                    ->  Index Only Scan using profiles_pkey on profiles p_1  (cost=0.13..11.45 rows=1 width=32) (never executed)
                          Index Cond: (id = oc.validator_id)
                          Filter: ((InitPlan 25).col1 AND ((id = (InitPlan 26).col1) OR (InitPlan 27).col1 OR EXISTS(SubPlan 37)))
                          Heap Fetches: 0
                          SubPlan 37
                            ->  Seq Scan on obligation_occurrences oc_2  (cost=2.34..4.26 rows=2 width=0) (never executed)
                                  Filter: ((InitPlan 32).col1 AND ((owner_id = p_1.id) OR (deputy_id = p_1.id) OR (validator_id = p_1.id)) AND ((domain_id = ANY ((InitPlan 33).col1)) OR (owner_id = (InitPlan 34).col1) OR (deputy_id = (InitPlan 35).col1) OR (validator_id = (InitPlan 36).col1)) AND ((domain_id = ANY ((InitPlan 28).col1)) OR (owner_id = (InitPlan 29).col1) OR (deputy_id = (InitPlan 30).col1) OR (validator_id = (InitPlan 31).col1)))
                                  InitPlan 28
                                    ->  Result  (cost=0.00..0.26 rows=1 width=32) (never executed)
                                  InitPlan 29
                                    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                                  InitPlan 30
                                    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                                  InitPlan 31
                                    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                                  InitPlan 32
                                    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                                  InitPlan 33
                                    ->  Result  (cost=0.00..0.26 rows=1 width=32) (never executed)
                                  InitPlan 34
                                    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                                  InitPlan 35
                                    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                                  InitPlan 36
                                    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
Planning:
  Buffers: shared hit=38
Planning Time: 0.602 ms
Execution Time: 0.082 ms
```

### Échéancier — page suivante (curseur)

La pagination par curseur, celle qui doit rester constante en coût.

```sql
select id, period_key, status, internal_due_date
          from public.occurrence_list
          where (internal_due_date, id) > (current_date, '00000000-0000-0000-0000-000000000000'::uuid)
          order by internal_due_date asc, id asc
          limit 25
```

```
Limit  (cost=46.82..46.82 rows=1 width=32) (actual time=0.007..0.009 rows=0 loops=1)
  Buffers: shared hit=1
  InitPlan 1
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 2
    ->  Result  (cost=0.00..0.26 rows=1 width=32) (never executed)
  InitPlan 3
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  InitPlan 4
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  InitPlan 5
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  ->  Sort  (cost=45.52..45.52 rows=1 width=32) (actual time=0.007..0.008 rows=0 loops=1)
        Sort Key: oc.internal_due_date, oc.id
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=1
        ->  Nested Loop Left Join  (cost=3.68..45.51 rows=1 width=32) (actual time=0.005..0.006 rows=0 loops=1)
              Buffers: shared hit=1
              ->  Nested Loop Left Join  (cost=2.77..33.26 rows=1 width=48) (actual time=0.005..0.005 rows=0 loops=1)
                    Buffers: shared hit=1
                    ->  Nested Loop Left Join  (cost=1.86..21.00 rows=1 width=64) (actual time=0.004..0.005 rows=0 loops=1)
                          Buffers: shared hit=1
                          ->  Nested Loop Left Join  (cost=1.45..12.56 rows=1 width=80) (actual time=0.004..0.005 rows=0 loops=1)
                                Buffers: shared hit=1
                                ->  Nested Loop  (cost=1.04..4.11 rows=1 width=96) (actual time=0.004..0.005 rows=0 loops=1)
                                      Buffers: shared hit=1
                                      ->  Seq Scan on obligation_occurrences oc  (cost=0.00..1.60 rows=1 width=80) (actual time=0.004..0.004 rows=0 loops=1)
                                            Filter: ((InitPlan 1).col1 AND (deleted_at IS NULL) AND (ROW(internal_due_date, id) > ROW(CURRENT_DATE, '00000000-0000-0000-0000-000000000000'::uuid)) AND ((domain_id = ANY ((InitPlan 2).col1)) OR (owner_id = (InitPlan 3).col1) OR (deputy_id = (InitPlan 4).col1) OR (validator_id = (InitPlan 5).col1)))
                                            Buffers: shared hit=1
                                      ->  Limit  (cost=1.04..2.49 rows=1 width=105) (never executed)
                                            InitPlan 6
                                              ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                                            InitPlan 7
                                              ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                                            InitPlan 8
                                              ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                                            InitPlan 9
                                              ->  Result  (cost=0.00..0.26 rows=1 width=32) (never executed)
                                            ->  Seq Scan on obligation_types ot  (cost=0.00..1.45 rows=1 width=105) (never executed)
                                                  Filter: ((InitPlan 6).col1 AND (id = oc.obligation_type_id) AND ((InitPlan 7).col1 OR ((InitPlan 8).col1 AND (domain_id = ANY ((InitPlan 9).col1)))))
                                ->  Limit  (cost=0.41..8.43 rows=1 width=64) (never executed)
                                      InitPlan 10
                                        ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                                      ->  Index Only Scan using domains_pkey on domains d  (cost=0.15..8.17 rows=1 width=64) (never executed)
                                            Index Cond: (id = ot.domain_id)
                                            Filter: (InitPlan 10).col1
                                            Heap Fetches: 0
                          ->  Limit  (cost=0.41..8.43 rows=1 width=32) (never executed)
                                InitPlan 11
                                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                                ->  Index Only Scan using authorities_pkey on authorities a  (cost=0.15..8.17 rows=1 width=32) (never executed)
                                      Index Cond: (id = ot.authority_id)
                                      Filter: (InitPlan 11).col1
                                      Heap Fetches: 0
                    ->  Limit  (cost=0.91..12.23 rows=1 width=32) (never executed)
                          InitPlan 12
                            ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                          InitPlan 13
                            ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                          InitPlan 14
                            ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                          ->  Index Only Scan using profiles_pkey on profiles p  (cost=0.13..11.45 rows=1 width=32) (never executed)
                                Index Cond: (id = oc.owner_id)
                                Filter: ((InitPlan 12).col1 AND ((id = (InitPlan 13).col1) OR (InitPlan 14).col1 OR EXISTS(SubPlan 24)))
                                Heap Fetches: 0
                                SubPlan 24
                                  ->  Seq Scan on obligation_occurrences oc_1  (cost=2.34..4.26 rows=2 width=0) (never executed)
                                        Filter: ((InitPlan 19).col1 AND ((owner_id = p.id) OR (deputy_id = p.id) OR (validator_id = p.id)) AND ((domain_id = ANY ((InitPlan 20).col1)) OR (owner_id = (InitPlan 21).col1) OR (deputy_id = (InitPlan 22).col1) OR (validator_id = (InitPlan 23).col1)) AND ((domain_id = ANY ((InitPlan 15).col1)) OR (owner_id = (InitPlan 16).col1) OR (deputy_id = (InitPlan 17).col1) OR (validator_id = (InitPlan 18).col1)))
                                        InitPlan 15
                                          ->  Result  (cost=0.00..0.26 rows=1 width=32) (never executed)
                                        InitPlan 16
                                          ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                                        InitPlan 17
                                          ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                                        InitPlan 18
                                          ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                                        InitPlan 19
                                          ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                                        InitPlan 20
                                          ->  Result  (cost=0.00..0.26 rows=1 width=32) (never executed)
                                        InitPlan 21
                                          ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                                        InitPlan 22
                                          ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                                        InitPlan 23
                                          ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
              ->  Limit  (cost=0.91..12.23 rows=1 width=32) (never executed)
                    InitPlan 25
                      ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                    InitPlan 26
                      ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                    InitPlan 27
                      ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                    ->  Index Only Scan using profiles_pkey on profiles p_1  (cost=0.13..11.45 rows=1 width=32) (never executed)
                          Index Cond: (id = oc.validator_id)
                          Filter: ((InitPlan 25).col1 AND ((id = (InitPlan 26).col1) OR (InitPlan 27).col1 OR EXISTS(SubPlan 37)))
                          Heap Fetches: 0
                          SubPlan 37
                            ->  Seq Scan on obligation_occurrences oc_2  (cost=2.34..4.26 rows=2 width=0) (never executed)
                                  Filter: ((InitPlan 32).col1 AND ((owner_id = p_1.id) OR (deputy_id = p_1.id) OR (validator_id = p_1.id)) AND ((domain_id = ANY ((InitPlan 33).col1)) OR (owner_id = (InitPlan 34).col1) OR (deputy_id = (InitPlan 35).col1) OR (validator_id = (InitPlan 36).col1)) AND ((domain_id = ANY ((InitPlan 28).col1)) OR (owner_id = (InitPlan 29).col1) OR (deputy_id = (InitPlan 30).col1) OR (validator_id = (InitPlan 31).col1)))
                                  InitPlan 28
                                    ->  Result  (cost=0.00..0.26 rows=1 width=32) (never executed)
                                  InitPlan 29
                                    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                                  InitPlan 30
                                    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                                  InitPlan 31
                                    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                                  InitPlan 32
                                    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                                  InitPlan 33
                                    ->  Result  (cost=0.00..0.26 rows=1 width=32) (never executed)
                                  InitPlan 34
                                    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                                  InitPlan 35
                                    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                                  InitPlan 36
                                    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
Planning:
  Buffers: shared hit=13
Planning Time: 0.552 ms
Execution Time: 0.084 ms
```

### Mes tâches

Ce dont l'utilisateur est responsable, groupé par urgence.

```sql
select id, period_key, status, internal_due_date
          from public.obligation_occurrences
          where owner_id = auth.uid() and deleted_at is null
          order by internal_due_date asc
          limit 50
```

```
Limit  (cost=3.19..3.19 rows=1 width=32) (actual time=0.005..0.005 rows=0 loops=1)
  Buffers: shared hit=1
  InitPlan 1
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 2
    ->  Result  (cost=0.00..0.26 rows=1 width=32) (never executed)
  InitPlan 3
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  InitPlan 4
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  InitPlan 5
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  ->  Sort  (cost=1.89..1.89 rows=1 width=32) (actual time=0.004..0.005 rows=0 loops=1)
        Sort Key: obligation_occurrences.internal_due_date
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=1
        ->  Seq Scan on obligation_occurrences  (cost=0.00..1.88 rows=1 width=32) (actual time=0.003..0.003 rows=0 loops=1)
              Filter: ((InitPlan 1).col1 AND (deleted_at IS NULL) AND ((domain_id = ANY ((InitPlan 2).col1)) OR (owner_id = (InitPlan 3).col1) OR (deputy_id = (InitPlan 4).col1) OR (validator_id = (InitPlan 5).col1)) AND (owner_id = (COALESCE(NULLIF(current_setting('request.jwt.claim.sub'::text, true), ''::text), ((NULLIF(current_setting('request.jwt.claims'::text, true), ''::text))::jsonb ->> 'sub'::text)))::uuid))
              Buffers: shared hit=1
Planning:
  Buffers: shared hit=49
Planning Time: 0.235 ms
Execution Time: 0.022 ms
```

### File de validation

Les dossiers en attente de MA validation.

```sql
select count(*) from public.obligation_occurrences
          where status = 'PENDING_VALIDATION' and deleted_at is null
```

```
Aggregate  (cost=2.82..2.83 rows=1 width=8) (actual time=0.004..0.004 rows=1 loops=1)
  Buffers: shared hit=1
  InitPlan 1
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 2
    ->  Result  (cost=0.00..0.26 rows=1 width=32) (never executed)
  InitPlan 3
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  InitPlan 4
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  InitPlan 5
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  ->  Seq Scan on obligation_occurrences  (cost=0.00..1.52 rows=1 width=0) (actual time=0.003..0.003 rows=0 loops=1)
        Filter: ((InitPlan 1).col1 AND (deleted_at IS NULL) AND ((domain_id = ANY ((InitPlan 2).col1)) OR (owner_id = (InitPlan 3).col1) OR (deputy_id = (InitPlan 4).col1) OR (validator_id = (InitPlan 5).col1)) AND (status = 'PENDING_VALIDATION'::occurrence_status))
        Buffers: shared hit=1
Planning:
  Buffers: shared hit=4
Planning Time: 0.133 ms
Execution Time: 0.027 ms
```

### Fiche d'un dossier — liste de contrôle

Les pièces attendues et celles déposées, pour un dossier.

```sql
select ci.id, ci.label, ci.is_mandatory, d.id as document_id
          from public.occurrence_checklist_items ci
          left join public.documents d
            on d.checklist_item_id = ci.id and d.deleted_at is null
          where ci.occurrence_id in (select id from public.obligation_occurrences limit 1)
```

```
Nested Loop Left Join  (cost=2.41..13.28 rows=1 width=65) (actual time=0.005..0.006 rows=0 loops=1)
  Join Filter: (d.checklist_item_id = ci.id)
  Buffers: shared hit=1
  InitPlan 1
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 14
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 15
    ->  Result  (cost=0.00..0.26 rows=1 width=32) (never executed)
  ->  Nested Loop  (cost=1.63..12.48 rows=1 width=49) (actual time=0.005..0.006 rows=0 loops=1)
        Buffers: shared hit=1
        ->  HashAggregate  (cost=1.49..1.50 rows=1 width=16) (actual time=0.005..0.005 rows=0 loops=1)
              Group Key: obligation_occurrences.id
              Batches: 1  Memory Usage: 24kB
              Buffers: shared hit=1
              ->  Limit  (cost=1.30..1.49 rows=1 width=16) (actual time=0.004..0.004 rows=0 loops=1)
                    Buffers: shared hit=1
                    InitPlan 28
                      ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                    InitPlan 29
                      ->  Result  (cost=0.00..0.26 rows=1 width=32) (never executed)
                    InitPlan 30
                      ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                    InitPlan 31
                      ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                    InitPlan 32
                      ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                    ->  Seq Scan on obligation_occurrences  (cost=0.00..1.48 rows=8 width=16) (actual time=0.003..0.003 rows=0 loops=1)
                          Filter: ((InitPlan 28).col1 AND ((domain_id = ANY ((InitPlan 29).col1)) OR (owner_id = (InitPlan 30).col1) OR (deputy_id = (InitPlan 31).col1) OR (validator_id = (InitPlan 32).col1)))
                          Buffers: shared hit=1
        ->  Index Scan using occurrence_checklist_items_occurrence_idx on occurrence_checklist_items ci  (cost=0.14..10.98 rows=1 width=65) (never executed)
              Index Cond: (occurrence_id = obligation_occurrences.id)
              Filter: ((InitPlan 1).col1 AND (ANY (occurrence_id = (hashed SubPlan 13).col1)))
              SubPlan 13
                ->  Seq Scan on obligation_occurrences oc  (cost=1.30..2.78 rows=8 width=16) (never executed)
                      Filter: ((InitPlan 8).col1 AND ((domain_id = ANY ((InitPlan 9).col1)) OR (owner_id = (InitPlan 10).col1) OR (deputy_id = (InitPlan 11).col1) OR (validator_id = (InitPlan 12).col1)))
                      InitPlan 8
                        ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                      InitPlan 9
                        ->  Result  (cost=0.00..0.26 rows=1 width=32) (never executed)
                      InitPlan 10
                        ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                      InitPlan 11
                        ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                      InitPlan 12
                        ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  ->  Seq Scan on documents d  (cost=0.00..0.00 rows=1 width=32) (never executed)
        Filter: ((InitPlan 14).col1 AND (deleted_at IS NULL) AND (deleted_at IS NULL) AND (obligation_domain_of_occurrence(occurrence_id) = ANY ((InitPlan 15).col1)) AND (ANY (occurrence_id = (hashed SubPlan 27).col1)))
        SubPlan 27
          ->  Seq Scan on obligation_occurrences oc_1  (cost=1.30..2.78 rows=8 width=16) (never executed)
                Filter: ((InitPlan 22).col1 AND ((domain_id = ANY ((InitPlan 23).col1)) OR (owner_id = (InitPlan 24).col1) OR (deputy_id = (InitPlan 25).col1) OR (validator_id = (InitPlan 26).col1)))
                InitPlan 22
                  ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                InitPlan 23
                  ->  Result  (cost=0.00..0.26 rows=1 width=32) (never executed)
                InitPlan 24
                  ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                InitPlan 25
                  ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                InitPlan 26
                  ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
Planning:
  Buffers: shared hit=240
Planning Time: 0.624 ms
Execution Time: 0.052 ms
```

### Documents — liste filtrée

L'écran /documents, trié par dépôt le plus récent.

```sql
select id, original_filename, document_kind, uploaded_at
          from public.documents
          where deleted_at is null
          order by uploaded_at desc
          limit 25
```

```
Limit  (cost=0.53..0.54 rows=1 width=88) (actual time=0.011..0.011 rows=0 loops=1)
  InitPlan 1
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 2
    ->  Result  (cost=0.00..0.26 rows=1 width=32) (never executed)
  ->  Sort  (cost=0.01..0.02 rows=1 width=88) (actual time=0.010..0.011 rows=0 loops=1)
        Sort Key: documents.uploaded_at DESC
        Sort Method: quicksort  Memory: 25kB
        ->  Seq Scan on documents  (cost=0.00..0.00 rows=1 width=88) (actual time=0.002..0.003 rows=0 loops=1)
              Filter: ((InitPlan 1).col1 AND (deleted_at IS NULL) AND (deleted_at IS NULL) AND (obligation_domain_of_occurrence(occurrence_id) = ANY ((InitPlan 2).col1)) AND (ANY (occurrence_id = (hashed SubPlan 14).col1)))
              SubPlan 14
                ->  Seq Scan on obligation_occurrences oc  (cost=1.30..2.78 rows=8 width=16) (never executed)
                      Filter: ((InitPlan 9).col1 AND ((domain_id = ANY ((InitPlan 10).col1)) OR (owner_id = (InitPlan 11).col1) OR (deputy_id = (InitPlan 12).col1) OR (validator_id = (InitPlan 13).col1)))
                      InitPlan 9
                        ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
                      InitPlan 10
                        ->  Result  (cost=0.00..0.26 rows=1 width=32) (never executed)
                      InitPlan 11
                        ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                      InitPlan 12
                        ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                      InitPlan 13
                        ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
Planning:
  Buffers: shared hit=10
Planning Time: 0.172 ms
Execution Time: 0.034 ms
```

### Référentiel des obligations

Le catalogue, avec sa recherche plein texte sur la procédure.

```sql
select id, code, name, periodicity
          from public.obligation_types
          where deleted_at is null
          order by code asc
          limit 50
```

```
Limit  (cost=2.54..2.56 rows=7 width=52) (actual time=0.011..0.011 rows=0 loops=1)
  Buffers: shared hit=4
  InitPlan 1
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 2
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 3
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 4
    ->  Result  (cost=0.00..0.26 rows=1 width=32) (never executed)
  ->  Sort  (cost=1.50..1.52 rows=7 width=52) (actual time=0.011..0.011 rows=0 loops=1)
        Sort Key: obligation_types.code
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=4
        ->  Seq Scan on obligation_types  (cost=0.00..1.41 rows=7 width=52) (actual time=0.003..0.003 rows=0 loops=1)
              Filter: ((InitPlan 1).col1 AND (deleted_at IS NULL) AND ((InitPlan 2).col1 OR ((InitPlan 3).col1 AND (domain_id = ANY ((InitPlan 4).col1)))))
              Buffers: shared hit=1
Planning:
  Buffers: shared hit=6
Planning Time: 0.063 ms
Execution Time: 0.027 ms
```

### Centre de notifications

Les notifications non lues de l'utilisateur.

```sql
select id, kind, created_at
          from public.notifications
          where recipient_id = auth.uid() and read_at is null
          order by created_at desc
          limit 20
```

```
Limit  (cost=2.35..2.36 rows=1 width=48) (actual time=0.008..0.009 rows=0 loops=1)
  Buffers: shared hit=1
  InitPlan 1
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 2
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  ->  Sort  (cost=1.83..1.84 rows=1 width=48) (actual time=0.008..0.008 rows=0 loops=1)
        Sort Key: notifications.created_at DESC
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=1
        ->  Seq Scan on notifications  (cost=0.00..1.82 rows=1 width=48) (actual time=0.006..0.006 rows=0 loops=1)
              Filter: ((InitPlan 1).col1 AND (read_at IS NULL) AND (recipient_id = (InitPlan 2).col1) AND (recipient_id = (COALESCE(NULLIF(current_setting('request.jwt.claim.sub'::text, true), ''::text), ((NULLIF(current_setting('request.jwt.claims'::text, true), ''::text))::jsonb ->> 'sub'::text)))::uuid))
              Buffers: shared hit=1
Planning:
  Buffers: shared hit=170
Planning Time: 0.299 ms
Execution Time: 0.022 ms
```

### Journal d'audit — dernière page

La consultation d'audit, table partitionnée et append-only.

```sql
select id, action, entity_table, occurred_at
          from public.audit_log
          order by occurred_at desc
          limit 50
```

```
Limit  (cost=4.58..19.11 rows=50 width=51) (actual time=1.189..1.194 rows=0 loops=1)
  Buffers: shared hit=271
  InitPlan 1
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.140..0.141 rows=1 loops=1)
          Buffers: shared hit=6
  InitPlan 2
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=1.034..1.035 rows=1 loops=1)
          Buffers: shared hit=265
  ->  Append  (cost=4.06..7742.59 rows=26619 width=51) (actual time=1.188..1.193 rows=0 loops=1)
        Buffers: shared hit=271
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=1.177..1.177 rows=0 loops=1)
              One-Time Filter: ((InitPlan 1).col1 AND (InitPlan 2).col1)
              Buffers: shared hit=271
              ->  Index Scan using audit_log_2028m10_occurred_at_idx on audit_log_2028m10 audit_log_27  (cost=0.14..47.00 rows=190 width=80) (never executed)
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.000..0.000 rows=0 loops=1)
              One-Time Filter: ((InitPlan 1).col1 AND (InitPlan 2).col1)
              ->  Index Scan using audit_log_2028m09_occurred_at_idx on audit_log_2028m09 audit_log_26  (cost=0.14..47.00 rows=190 width=80) (never executed)
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.000..0.000 rows=0 loops=1)
              One-Time Filter: ((InitPlan 1).col1 AND (InitPlan 2).col1)
              ->  Index Scan using audit_log_2028m08_occurred_at_idx on audit_log_2028m08 audit_log_25  (cost=0.14..47.00 rows=190 width=80) (never executed)
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.000..0.000 rows=0 loops=1)
              One-Time Filter: ((InitPlan 1).col1 AND (InitPlan 2).col1)
              ->  Index Scan using audit_log_2028m07_occurred_at_idx on audit_log_2028m07 audit_log_24  (cost=0.14..47.00 rows=190 width=80) (never executed)
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.000..0.000 rows=0 loops=1)
              One-Time Filter: ((InitPlan 1).col1 AND (InitPlan 2).col1)
              ->  Index Scan using audit_log_2028m06_occurred_at_idx on audit_log_2028m06 audit_log_23  (cost=0.14..47.00 rows=190 width=80) (never executed)
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.000..0.000 rows=0 loops=1)
              One-Time Filter: ((InitPlan 1).col1 AND (InitPlan 2).col1)
              ->  Index Scan using audit_log_2028m05_occurred_at_idx on audit_log_2028m05 audit_log_22  (cost=0.14..47.00 rows=190 width=80) (never executed)
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.000..0.000 rows=0 loops=1)
              One-Time Filter: ((InitPlan 1).col1 AND (InitPlan 2).col1)
              ->  Index Scan using audit_log_2028m04_occurred_at_idx on audit_log_2028m04 audit_log_21  (cost=0.14..47.00 rows=190 width=80) (never executed)
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.000..0.000 rows=0 loops=1)
              One-Time Filter: ((InitPlan 1).col1 AND (InitPlan 2).col1)
              ->  Index Scan using audit_log_2028m03_occurred_at_idx on audit_log_2028m03 audit_log_20  (cost=0.14..47.00 rows=190 width=80) (never executed)
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.000..0.000 rows=0 loops=1)
              One-Time Filter: ((InitPlan 1).col1 AND (InitPlan 2).col1)
              ->  Index Scan using audit_log_2028m02_occurred_at_idx on audit_log_2028m02 audit_log_19  (cost=0.14..47.00 rows=190 width=80) (never executed)
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.000..0.001 rows=0 loops=1)
              One-Time Filter: ((InitPlan 1).col1 AND (InitPlan 2).col1)
              ->  Index Scan using audit_log_2028m01_occurred_at_idx on audit_log_2028m01 audit_log_18  (cost=0.14..47.00 rows=190 width=80) (never executed)
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.000..0.000 rows=0 loops=1)
              One-Time Filter: ((InitPlan 1).col1 AND (InitPlan 2).col1)
              ->  Index Scan using audit_log_2027m12_occurred_at_idx on audit_log_2027m12 audit_log_17  (cost=0.14..47.00 rows=190 width=80) (never executed)
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.000..0.000 rows=0 loops=1)
              One-Time Filter: ((InitPlan 1).col1 AND (InitPlan 2).col1)
              ->  Index Scan using audit_log_2027m11_occurred_at_idx on audit_log_2027m11 audit_log_16  (cost=0.14..47.00 rows=190 width=80) (never executed)
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.000..0.000 rows=0 loops=1)
              One-Time Filter: ((InitPlan 1).col1 AND (InitPlan 2).col1)
              ->  Index Scan using audit_log_2027m10_occurred_at_idx on audit_log_2027m10 audit_log_15  (cost=0.14..47.00 rows=190 width=80) (never executed)
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.000..0.000 rows=0 loops=1)
              One-Time Filter: ((InitPlan 1).col1 AND (InitPlan 2).col1)
              ->  Index Scan using audit_log_2027m09_occurred_at_idx on audit_log_2027m09 audit_log_14  (cost=0.14..47.00 rows=190 width=80) (never executed)
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.000..0.000 rows=0 loops=1)
              One-Time Filter: ((InitPlan 1).col1 AND (InitPlan 2).col1)
              ->  Index Scan using audit_log_2027m08_occurred_at_idx on audit_log_2027m08 audit_log_13  (cost=0.14..47.00 rows=190 width=80) (never executed)
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.000..0.001 rows=0 loops=1)
              One-Time Filter: ((InitPlan 1).col1 AND (InitPlan 2).col1)
              ->  Index Scan using audit_log_2027m07_occurred_at_idx on audit_log_2027m07 audit_log_12  (cost=0.14..47.00 rows=190 width=80) (never executed)
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.000..0.000 rows=0 loops=1)
              One-Time Filter: ((InitPlan 1).col1 AND (InitPlan 2).col1)
              ->  Index Scan using audit_log_2027m06_occurred_at_idx on audit_log_2027m06 audit_log_11  (cost=0.14..47.00 rows=190 width=80) (never executed)
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.000..0.000 rows=0 loops=1)
              One-Time Filter: ((InitPlan 1).col1 AND (InitPlan 2).col1)
              ->  Index Scan using audit_log_2027m05_occurred_at_idx on audit_log_2027m05 audit_log_10  (cost=0.14..47.00 rows=190 width=80) (never executed)
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.000..0.000 rows=0 loops=1)
              One-Time Filter: ((InitPlan 1).col1 AND (InitPlan 2).col1)
              ->  Index Scan using audit_log_2027m04_occurred_at_idx on audit_log_2027m04 audit_log_9  (cost=0.14..47.00 rows=190 width=80) (never executed)
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.000..0.000 rows=0 loops=1)
              One-Time Filter: ((InitPlan 1).col1 AND (InitPlan 2).col1)
              ->  Index Scan using audit_log_2027m03_occurred_at_idx on audit_log_2027m03 audit_log_8  (cost=0.14..47.00 rows=190 width=80) (never executed)
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.000..0.000 rows=0 loops=1)
              One-Time Filter: ((InitPlan 1).col1 AND (InitPlan 2).col1)
              ->  Index Scan using audit_log_2027m02_occurred_at_idx on audit_log_2027m02 audit_log_7  (cost=0.14..47.00 rows=190 width=80) (never executed)
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.000..0.000 rows=0 loops=1)
              One-Time Filter: ((InitPlan 1).col1 AND (InitPlan 2).col1)
              ->  Index Scan using audit_log_2027m01_occurred_at_idx on audit_log_2027m01 audit_log_6  (cost=0.14..47.00 rows=190 width=80) (never executed)
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.000..0.000 rows=0 loops=1)
              One-Time Filter: ((InitPlan 1).col1 AND (InitPlan 2).col1)
              ->  Index Scan using audit_log_2026m12_occurred_at_idx on audit_log_2026m12 audit_log_5  (cost=0.14..47.00 rows=190 width=80) (never executed)
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.000..0.000 rows=0 loops=1)
              One-Time Filter: ((InitPlan 1).col1 AND (InitPlan 2).col1)
              ->  Index Scan using audit_log_2026m11_occurred_at_idx on audit_log_2026m11 audit_log_4  (cost=0.14..47.00 rows=190 width=80) (never executed)
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.000..0.000 rows=0 loops=1)
              One-Time Filter: ((InitPlan 1).col1 AND (InitPlan 2).col1)
              ->  Index Scan using audit_log_2026m10_occurred_at_idx on audit_log_2026m10 audit_log_3  (cost=0.14..47.00 rows=190 width=80) (never executed)
        ->  Result  (cost=0.29..6387.62 rows=21679 width=44) (actual time=0.000..0.000 rows=0 loops=1)
              One-Time Filter: ((InitPlan 1).col1 AND (InitPlan 2).col1)
              ->  Index Scan using audit_log_2026m09_occurred_at_idx on audit_log_2026m09 audit_log_2  (cost=0.29..6387.62 rows=21679 width=44) (never executed)
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.000..0.000 rows=0 loops=1)
              One-Time Filter: ((InitPlan 1).col1 AND (InitPlan 2).col1)
              ->  Index Scan using audit_log_2026m08_occurred_at_idx on audit_log_2026m08 audit_log_1  (cost=0.14..47.00 rows=190 width=80) (never executed)
Planning:
  Buffers: shared hit=3748
Planning Time: 4.087 ms
Execution Time: 1.270 ms
```
