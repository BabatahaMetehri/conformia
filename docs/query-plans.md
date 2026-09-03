# Plans d'exécution

> Relevé le 2026-09-02 par `node scripts/query-plans.ts`, sur la base locale.
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

## Synthèse

| Requête | Planification | Exécution | Balayages séquentiels |
| --- | ---: | ---: | ---: |
| Échéancier — première page | 1.95 ms | 3.36 ms | 4 |
| Échéancier — filtré par domaine et statut | 0.98 ms | 2.69 ms | 3 |
| Échéancier — page suivante (curseur) | 0.88 ms | 2.57 ms | 3 |
| Mes tâches | 0.23 ms | 2.45 ms | 1 |
| File de validation | 0.21 ms | 2.64 ms | 0 |
| Fiche d'un dossier — liste de contrôle | 1.16 ms | 2.57 ms | 2 |
| Documents — liste filtrée | 0.47 ms | 0.02 ms | 1 |
| Référentiel des obligations | 0.12 ms | 0.60 ms | 1 |
| Centre de notifications | 0.49 ms | 0.02 ms | 1 |
| Journal d'audit — dernière page | 3.71 ms | 13.83 ms | 0 |

Aucune requête au-dessus de 200 ms sur ce jeu de données.

## Volumes au moment du relevé

| Table | Lignes (estimation) | Taille totale |
| --- | ---: | ---: |
| `audit_log_2026m09` | 5423 | 7176 kB |
| `auth_attempts` | 841 | 496 kB |
| `obligation_occurrences` | 26 | 328 kB |
| `documents` | 0 | 240 kB |
| `document_upload_tickets` | 1 | 152 kB |
| `obligation_types` | 1 | 144 kB |
| `notifications` | 0 | 128 kB |
| `export_runs` | 3 | 112 kB |
| `document_access_log_2026m09` | -1 | 96 kB |
| `occurrence_transitions` | 14 | 80 kB |
| `obligation_required_documents` | 4 | 80 kB |
| `user_roles` | -1 | 80 kB |
| `occurrence_checklist_items` | 29 | 80 kB |
| `profiles` | 19 | 64 kB |
| `notification_rules` | -1 | 64 kB |

## Les dix requêtes les plus fréquentes

Relevé de `pg_stat_statements`, tel quel. Les requêtes y sont **normalisées**
(paramètres remplacés par `$1`) : elles ne sont pas rejouables telles quelles,
d'où les sondes explicites ci-dessus.

| Appels | Moyenne | Total | Requête |
| ---: | ---: | ---: | --- |
| 65441 | 0.02 ms | 1492.5 ms | `select set_config('search_path', $1, true), set_config($2, $3, true), set_config('role', $4, true), set_config('request.jwt.claims', $5, true), set_config('requ` |
| 14723 | 1.00 ms | 14715.4 ms | `WITH pgrst_source AS (SELECT pgrst_call.pgrst_scalar FROM (SELECT $1 AS json_data) pgrst_payload, LATERAL (SELECT "p_ip" FROM json_to_record(pgrst_payload.json_` |
| 4478 | 0.37 ms | 1675.4 ms | `WITH pgrst_source AS (SELECT pgrst_call.pgrst_scalar FROM (SELECT $1 AS json_data) pgrst_payload, LATERAL (SELECT "p_user_id" FROM json_to_record(pgrst_payload.` |
| 4478 | 0.18 ms | 815.5 ms | `WITH pgrst_source AS (SELECT pgrst_call.pgrst_scalar FROM (SELECT $1 AS json_data) pgrst_payload, LATERAL (SELECT "p_user_id" FROM json_to_record(pgrst_payload.` |
| 3515 | 1.05 ms | 3675.2 ms | `WITH pgrst_source AS ( SELECT "public"."user_roles"."domain_id", "public"."user_roles"."expires_at", row_to_json("user_roles_roles_1".*)::jsonb AS "roles" FROM ` |
| 3515 | 2.06 ms | 7234.7 ms | `WITH pgrst_source AS ( SELECT row_to_json("user_roles_role_permissions_1".*)::jsonb AS "role_permissions" FROM "public"."user_roles" INNER JOIN LATERAL ( SELECT` |
| 3515 | 0.01 ms | 44.9 ms | `WITH pgrst_source AS ( SELECT "public"."validation_delegations"."delegator_id", "public"."validation_delegations"."domain_id", "public"."validation_delegations"` |
| 3515 | 0.24 ms | 835.7 ms | `WITH pgrst_source AS ( SELECT "public"."profiles"."id", "public"."profiles"."entity_id", "public"."profiles"."department_id", "public"."profiles"."full_name", "` |
| 2480 | 9.61 ms | 23834.2 ms | `WITH pgrst_source AS (SELECT "pgrst_call".* FROM "public"."navigation_counters"() pgrst_call) SELECT $3::bigint AS total_result_set, pg_catalog.count(_postgrest` |
| 2445 | 0.19 ms | 473.8 ms | `WITH pgrst_source AS ( SELECT "public"."notifications"."id" FROM "public"."notifications" WHERE "public"."notifications"."channel" = $1 AND "public"."notificati` |

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
| `audit_log_2026m09` | `audit_log_2026m09_action_occurred_at_idx` | 0 | 264 kB |
| `audit_log_2026m09` | `audit_log_2026m09_actor_id_occurred_at_idx` | 0 | 264 kB |
| `auth_attempts` | `auth_attempts_pkey` | 0 | 40 kB |
| `document_upload_tickets` | `document_upload_tickets_storage_path_key` | 0 | 32 kB |
| `obligation_occurrences` | `obligation_occurrences_search_idx` | 0 | 24 kB |
| `obligation_types` | `obligation_types_search_idx` | 0 | 24 kB |
| `documents` | `documents_search_idx` | 0 | 24 kB |
| `escalation_policies` | `escalation_policies_lookup_idx` | 0 | 16 kB |
| `notification_rules` | `notification_rules_pkey` | 0 | 16 kB |
| `export_runs` | `export_runs_pending_idx` | 0 | 16 kB |
| `transition_notifications` | `transition_notifications_pkey` | 0 | 16 kB |
| `dashboard_compliance_monthly` | `dashboard_compliance_monthly_key_idx` | 0 | 16 kB |
| `notification_rules` | `notification_rules_lookup_idx` | 0 | 16 kB |
| `escalation_policies` | `escalation_policies_pkey` | 0 | 16 kB |
| `dashboard_workload` | `dashboard_workload_key_idx` | 0 | 16 kB |
| `holidays` | `holidays_pkey` | 0 | 16 kB |
| `document_upload_tickets` | `document_upload_tickets_creator_idx` | 0 | 16 kB |
| `dashboard_upcoming_load` | `dashboard_upcoming_load_key_idx` | 0 | 16 kB |
| `obligation_types` | `obligation_types_entity_code_key` | 0 | 16 kB |
| `dashboard_health` | `dashboard_health_key_idx` | 0 | 16 kB |
| `obligation_occurrences` | `obligation_occurrences_rectification_idx` | 0 | 16 kB |
| `entities` | `entities_code_key` | 0 | 16 kB |
| `occurrence_comments` | `occurrence_comments_pkey` | 0 | 16 kB |
| `obligation_occurrences` | `obligation_occurrences_entity_status_due_idx` | 0 | 16 kB |
| `permissions` | `permissions_code_key` | 0 | 16 kB |
| `transition_notifications` | `transition_notifications_key` | 0 | 16 kB |
| `status_transition_rules` | `status_transition_rules_pkey` | 0 | 16 kB |
| `obligation_types` | `obligation_types_entity_domain_idx` | 0 | 16 kB |
| `job_runs` | `job_runs_name_idx` | 0 | 16 kB |
| `job_runs` | `job_runs_unfinished_idx` | 0 | 16 kB |
| `profiles` | `profiles_ics_token_key` | 0 | 16 kB |
| `profiles` | `profiles_email_key` | 0 | 16 kB |
| `document_access_log_2026m09` | `document_access_log_2026m09_pkey` | 0 | 16 kB |
| `occurrence_transitions` | `occurrence_transitions_pkey` | 0 | 16 kB |
| `occurrence_stats` | `occurrence_stats_key_idx` | 0 | 16 kB |
| `obligation_occurrences` | `obligation_occurrences_owner_status_idx` | 0 | 16 kB |
| `document_access_log_2026m09` | `document_access_log_2026m09_actor_id_created_at_idx` | 0 | 16 kB |
| `obligation_occurrences` | `obligation_occurrences_validator_idx` | 0 | 16 kB |
| `documents` | `documents_sha256_idx` | 0 | 16 kB |
| `notifications` | `notifications_read_state_idx` | 0 | 16 kB |

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
Limit  (cost=360.88..360.89 rows=3 width=36) (actual time=3.195..3.199 rows=0 loops=1)
  Buffers: shared hit=572
  ->  Sort  (cost=360.88..360.89 rows=3 width=36) (actual time=3.195..3.198 rows=0 loops=1)
        Sort Key: oc.internal_due_date, oc.id
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=572
        ->  Nested Loop Left Join  (cost=8.39..360.86 rows=3 width=36) (actual time=3.174..3.178 rows=0 loops=1)
              Buffers: shared hit=566
              ->  Nested Loop Left Join  (cost=8.24..245.68 rows=3 width=52) (actual time=3.174..3.177 rows=0 loops=1)
                    Buffers: shared hit=566
                    ->  Nested Loop Left Join  (cost=8.09..84.45 rows=3 width=68) (actual time=3.174..3.176 rows=0 loops=1)
                          Buffers: shared hit=566
                          ->  Nested Loop Left Join  (cost=7.94..70.34 rows=3 width=84) (actual time=3.173..3.175 rows=0 loops=1)
                                Buffers: shared hit=566
                                ->  Nested Loop  (cost=7.78..56.22 rows=3 width=100) (actual time=3.173..3.174 rows=0 loops=1)
                                      Buffers: shared hit=566
                                      ->  Seq Scan on obligation_occurrences oc  (cost=0.00..33.89 rows=3 width=84) (actual time=3.173..3.173 rows=0 loops=1)
                                            Filter: ((deleted_at IS NULL) AND is_active_user() AND (has_permission_in_domain('occurrence.read'::text, obligation_domain_of_type(obligation_type_id)) OR (owner_id = current_profile_id()) OR (validator_id = current_profile_id())))
                                            Rows Removed by Filter: 14
                                            Buffers: shared hit=566
                                      ->  Memoize  (cost=7.78..9.55 rows=1 width=32) (never executed)
                                            Cache Key: oc.obligation_type_id
                                            Cache Mode: binary
                                            ->  Subquery Scan on ot  (cost=7.77..9.54 rows=1 width=32) (never executed)
                                                  ->  Limit  (cost=7.77..9.53 rows=1 width=105) (never executed)
                                                        ->  Seq Scan on obligation_types ot_1  (cost=7.77..9.53 rows=1 width=105) (never executed)
                                                              Filter: ((id = oc.obligation_type_id) AND is_active_user() AND (is_admin() OR (has_permission('obligation.read'::text) AND ((domain_id IS NULL) OR (ANY (domain_id = (hashed SubPlan 1).col1))))))
                                                              SubPlan 1
                                                                ->  ProjectSet  (cost=0.00..5.27 rows=1000 width=16) (never executed)
                                                                      ->  Result  (cost=0.00..0.01 rows=1 width=0) (never executed)
                                ->  Memoize  (cost=0.16..8.44 rows=1 width=0) (never executed)
                                      Cache Key: ot.domain_id
                                      Cache Mode: binary
                                      ->  Subquery Scan on dom  (cost=0.15..8.43 rows=1 width=0) (never executed)
                                            ->  Limit  (cost=0.15..8.42 rows=1 width=64) (never executed)
                                                  ->  Index Only Scan using domains_pkey on domains d  (cost=0.15..8.42 rows=1 width=64) (never executed)
                                                        Index Cond: (id = ot.domain_id)
                                                        Filter: is_active_user()
                                                        Heap Fetches: 0
                          ->  Memoize  (cost=0.16..8.44 rows=1 width=0) (never executed)
                                Cache Key: ot.authority_id
                                Cache Mode: binary
                                ->  Subquery Scan on auth_org  (cost=0.15..8.43 rows=1 width=0) (never executed)
                                      ->  Limit  (cost=0.15..8.42 rows=1 width=32) (never executed)
                                            ->  Index Only Scan using authorities_pkey on authorities a  (cost=0.15..8.42 rows=1 width=32) (never executed)
                                                  Index Cond: (id = ot.authority_id)
                                                  Filter: is_active_user()
                                                  Heap Fetches: 0
                    ->  Memoize  (cost=0.15..69.08 rows=1 width=0) (never executed)
                          Cache Key: oc.owner_id
                          Cache Mode: binary
                          ->  Subquery Scan on owner_profile  (cost=0.14..69.07 rows=1 width=0) (never executed)
                                ->  Limit  (cost=0.14..69.06 rows=1 width=32) (never executed)
                                      ->  Index Only Scan using profiles_pkey on profiles p  (cost=0.14..69.06 rows=1 width=32) (never executed)
                                            Index Cond: (id = oc.owner_id)
                                            Filter: (is_active_user() AND ((id = current_profile_id()) OR has_permission('user.manage'::text) OR EXISTS(SubPlan 2)))
                                            Heap Fetches: 0
                                            SubPlan 2
                                              ->  Seq Scan on obligation_occurrences oc_1  (cost=0.00..60.15 rows=1 width=0) (never executed)
                                                    Filter: (((owner_id = p.id) OR (validator_id = p.id)) AND is_active_user() AND (has_permission_in_domain('occurrence.read'::text, obligation_domain_of_type(obligation_type_id)) OR (owner_id = current_profile_id()) OR (validator_id = current_profile_id())) AND (has_permission_in_domain('occurrence.read'::text, obligation_domain_of_type(obligation_type_id)) OR (owner_id = current_profile_id()) OR (validator_id = current_profile_id())))
              ->  Memoize  (cost=0.15..69.08 rows=1 width=0) (never executed)
                    Cache Key: oc.validator_id
                    Cache Mode: binary
                    ->  Subquery Scan on validator_profile  (cost=0.14..69.07 rows=1 width=0) (never executed)
                          ->  Limit  (cost=0.14..69.06 rows=1 width=32) (never executed)
                                ->  Index Only Scan using profiles_pkey on profiles p_1  (cost=0.14..69.06 rows=1 width=32) (never executed)
                                      Index Cond: (id = oc.validator_id)
                                      Filter: (is_active_user() AND ((id = current_profile_id()) OR has_permission('user.manage'::text) OR EXISTS(SubPlan 3)))
                                      Heap Fetches: 0
                                      SubPlan 3
                                        ->  Seq Scan on obligation_occurrences oc_2  (cost=0.00..60.15 rows=1 width=0) (never executed)
                                              Filter: (((owner_id = p_1.id) OR (validator_id = p_1.id)) AND is_active_user() AND (has_permission_in_domain('occurrence.read'::text, obligation_domain_of_type(obligation_type_id)) OR (owner_id = current_profile_id()) OR (validator_id = current_profile_id())) AND (has_permission_in_domain('occurrence.read'::text, obligation_domain_of_type(obligation_type_id)) OR (owner_id = current_profile_id()) OR (validator_id = current_profile_id())))
Planning:
  Buffers: shared hit=738
Planning Time: 1.950 ms
Execution Time: 3.357 ms
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
Limit  (cost=338.95..338.96 rows=3 width=32) (actual time=2.636..2.640 rows=0 loops=1)
  Buffers: shared hit=282
  ->  Sort  (cost=338.95..338.96 rows=3 width=32) (actual time=2.636..2.639 rows=0 loops=1)
        Sort Key: oc.internal_due_date, oc.id
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=282
        ->  Nested Loop Left Join  (cost=8.53..338.93 rows=3 width=32) (actual time=2.633..2.636 rows=0 loops=1)
              Buffers: shared hit=282
              ->  Nested Loop Left Join  (cost=8.38..223.74 rows=3 width=48) (actual time=2.633..2.636 rows=0 loops=1)
                    Buffers: shared hit=282
                    ->  Nested Loop Left Join  (cost=8.23..62.52 rows=3 width=64) (actual time=2.633..2.634 rows=0 loops=1)
                          Buffers: shared hit=282
                          ->  Nested Loop Left Join  (cost=8.07..48.40 rows=3 width=80) (actual time=2.632..2.634 rows=0 loops=1)
                                Buffers: shared hit=282
                                ->  Nested Loop  (cost=7.91..34.29 rows=3 width=96) (actual time=2.632..2.633 rows=0 loops=1)
                                      Buffers: shared hit=282
                                      ->  Index Scan using obligation_occurrences_open_due_idx on obligation_occurrences oc  (cost=0.14..11.96 rows=3 width=80) (actual time=2.632..2.632 rows=0 loops=1)
                                            Filter: ((deleted_at IS NULL) AND is_active_user() AND (has_permission_in_domain('occurrence.read'::text, obligation_domain_of_type(obligation_type_id)) OR (owner_id = current_profile_id()) OR (validator_id = current_profile_id())) AND (status = ANY ('{TODO,IN_PROGRESS,PENDING_VALIDATION}'::occurrence_status[])))
                                            Rows Removed by Filter: 14
                                            Buffers: shared hit=282
                                      ->  Memoize  (cost=7.78..9.55 rows=1 width=32) (never executed)
                                            Cache Key: oc.obligation_type_id
                                            Cache Mode: binary
                                            ->  Subquery Scan on ot  (cost=7.77..9.54 rows=1 width=32) (never executed)
                                                  ->  Limit  (cost=7.77..9.53 rows=1 width=105) (never executed)
                                                        ->  Seq Scan on obligation_types ot_1  (cost=7.77..9.53 rows=1 width=105) (never executed)
                                                              Filter: ((id = oc.obligation_type_id) AND is_active_user() AND (is_admin() OR (has_permission('obligation.read'::text) AND ((domain_id IS NULL) OR (ANY (domain_id = (hashed SubPlan 1).col1))))))
                                                              SubPlan 1
                                                                ->  ProjectSet  (cost=0.00..5.27 rows=1000 width=16) (never executed)
                                                                      ->  Result  (cost=0.00..0.01 rows=1 width=0) (never executed)
                                ->  Memoize  (cost=0.16..8.44 rows=1 width=0) (never executed)
                                      Cache Key: ot.domain_id
                                      Cache Mode: binary
                                      ->  Subquery Scan on dom  (cost=0.15..8.43 rows=1 width=0) (never executed)
                                            ->  Limit  (cost=0.15..8.42 rows=1 width=64) (never executed)
                                                  ->  Index Only Scan using domains_pkey on domains d  (cost=0.15..8.42 rows=1 width=64) (never executed)
                                                        Index Cond: (id = ot.domain_id)
                                                        Filter: is_active_user()
                                                        Heap Fetches: 0
                          ->  Memoize  (cost=0.16..8.44 rows=1 width=0) (never executed)
                                Cache Key: ot.authority_id
                                Cache Mode: binary
                                ->  Subquery Scan on auth_org  (cost=0.15..8.43 rows=1 width=0) (never executed)
                                      ->  Limit  (cost=0.15..8.42 rows=1 width=32) (never executed)
                                            ->  Index Only Scan using authorities_pkey on authorities a  (cost=0.15..8.42 rows=1 width=32) (never executed)
                                                  Index Cond: (id = ot.authority_id)
                                                  Filter: is_active_user()
                                                  Heap Fetches: 0
                    ->  Memoize  (cost=0.15..69.08 rows=1 width=0) (never executed)
                          Cache Key: oc.owner_id
                          Cache Mode: binary
                          ->  Subquery Scan on owner_profile  (cost=0.14..69.07 rows=1 width=0) (never executed)
                                ->  Limit  (cost=0.14..69.06 rows=1 width=32) (never executed)
                                      ->  Index Only Scan using profiles_pkey on profiles p  (cost=0.14..69.06 rows=1 width=32) (never executed)
                                            Index Cond: (id = oc.owner_id)
                                            Filter: (is_active_user() AND ((id = current_profile_id()) OR has_permission('user.manage'::text) OR EXISTS(SubPlan 2)))
                                            Heap Fetches: 0
                                            SubPlan 2
                                              ->  Seq Scan on obligation_occurrences oc_1  (cost=0.00..60.15 rows=1 width=0) (never executed)
                                                    Filter: (((owner_id = p.id) OR (validator_id = p.id)) AND is_active_user() AND (has_permission_in_domain('occurrence.read'::text, obligation_domain_of_type(obligation_type_id)) OR (owner_id = current_profile_id()) OR (validator_id = current_profile_id())) AND (has_permission_in_domain('occurrence.read'::text, obligation_domain_of_type(obligation_type_id)) OR (owner_id = current_profile_id()) OR (validator_id = current_profile_id())))
              ->  Memoize  (cost=0.15..69.08 rows=1 width=0) (never executed)
                    Cache Key: oc.validator_id
                    Cache Mode: binary
                    ->  Subquery Scan on validator_profile  (cost=0.14..69.07 rows=1 width=0) (never executed)
                          ->  Limit  (cost=0.14..69.06 rows=1 width=32) (never executed)
                                ->  Index Only Scan using profiles_pkey on profiles p_1  (cost=0.14..69.06 rows=1 width=32) (never executed)
                                      Index Cond: (id = oc.validator_id)
                                      Filter: (is_active_user() AND ((id = current_profile_id()) OR has_permission('user.manage'::text) OR EXISTS(SubPlan 3)))
                                      Heap Fetches: 0
                                      SubPlan 3
                                        ->  Seq Scan on obligation_occurrences oc_2  (cost=0.00..60.15 rows=1 width=0) (never executed)
                                              Filter: (((owner_id = p_1.id) OR (validator_id = p_1.id)) AND is_active_user() AND (has_permission_in_domain('occurrence.read'::text, obligation_domain_of_type(obligation_type_id)) OR (owner_id = current_profile_id()) OR (validator_id = current_profile_id())) AND (has_permission_in_domain('occurrence.read'::text, obligation_domain_of_type(obligation_type_id)) OR (owner_id = current_profile_id()) OR (validator_id = current_profile_id())))
Planning:
  Buffers: shared hit=55
Planning Time: 0.983 ms
Execution Time: 2.695 ms
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
Limit  (cost=8.52..281.72 rows=2 width=32) (actual time=2.512..2.515 rows=0 loops=1)
  Buffers: shared hit=282
  ->  Nested Loop Left Join  (cost=8.52..281.72 rows=2 width=32) (actual time=2.512..2.515 rows=0 loops=1)
        Buffers: shared hit=282
        ->  Nested Loop Left Join  (cost=8.37..178.07 rows=2 width=48) (actual time=2.511..2.514 rows=0 loops=1)
              Buffers: shared hit=282
              ->  Nested Loop Left Join  (cost=8.22..74.42 rows=2 width=64) (actual time=2.511..2.513 rows=0 loops=1)
                    Buffers: shared hit=282
                    ->  Nested Loop Left Join  (cost=8.06..61.74 rows=2 width=80) (actual time=2.511..2.513 rows=0 loops=1)
                          Buffers: shared hit=282
                          ->  Nested Loop  (cost=7.91..49.05 rows=2 width=96) (actual time=2.511..2.512 rows=0 loops=1)
                                Buffers: shared hit=282
                                ->  Index Scan using obligation_occurrences_internal_due_cursor_idx on obligation_occurrences oc  (cost=0.14..29.95 rows=2 width=80) (actual time=2.511..2.511 rows=0 loops=1)
                                      Index Cond: (ROW(internal_due_date, id) > ROW(CURRENT_DATE, '00000000-0000-0000-0000-000000000000'::uuid))
                                      Filter: (is_active_user() AND (has_permission_in_domain('occurrence.read'::text, obligation_domain_of_type(obligation_type_id)) OR (owner_id = current_profile_id()) OR (validator_id = current_profile_id())))
                                      Rows Removed by Filter: 14
                                      Buffers: shared hit=282
                                ->  Limit  (cost=7.77..9.53 rows=1 width=105) (never executed)
                                      ->  Seq Scan on obligation_types ot  (cost=7.77..9.53 rows=1 width=105) (never executed)
                                            Filter: ((id = oc.obligation_type_id) AND is_active_user() AND (is_admin() OR (has_permission('obligation.read'::text) AND ((domain_id IS NULL) OR (ANY (domain_id = (hashed SubPlan 1).col1))))))
                                            SubPlan 1
                                              ->  ProjectSet  (cost=0.00..5.27 rows=1000 width=16) (never executed)
                                                    ->  Result  (cost=0.00..0.01 rows=1 width=0) (never executed)
                          ->  Memoize  (cost=0.16..8.44 rows=1 width=0) (never executed)
                                Cache Key: ot.domain_id
                                Cache Mode: binary
                                ->  Subquery Scan on dom  (cost=0.15..8.43 rows=1 width=0) (never executed)
                                      ->  Limit  (cost=0.15..8.42 rows=1 width=64) (never executed)
                                            ->  Index Only Scan using domains_pkey on domains d  (cost=0.15..8.42 rows=1 width=64) (never executed)
                                                  Index Cond: (id = ot.domain_id)
                                                  Filter: is_active_user()
                                                  Heap Fetches: 0
                    ->  Memoize  (cost=0.16..8.44 rows=1 width=0) (never executed)
                          Cache Key: ot.authority_id
                          Cache Mode: binary
                          ->  Subquery Scan on auth_org  (cost=0.15..8.43 rows=1 width=0) (never executed)
                                ->  Limit  (cost=0.15..8.42 rows=1 width=32) (never executed)
                                      ->  Index Only Scan using authorities_pkey on authorities a  (cost=0.15..8.42 rows=1 width=32) (never executed)
                                            Index Cond: (id = ot.authority_id)
                                            Filter: is_active_user()
                                            Heap Fetches: 0
              ->  Memoize  (cost=0.15..69.08 rows=1 width=0) (never executed)
                    Cache Key: oc.owner_id
                    Cache Mode: binary
                    ->  Subquery Scan on owner_profile  (cost=0.14..69.07 rows=1 width=0) (never executed)
                          ->  Limit  (cost=0.14..69.06 rows=1 width=32) (never executed)
                                ->  Index Only Scan using profiles_pkey on profiles p  (cost=0.14..69.06 rows=1 width=32) (never executed)
                                      Index Cond: (id = oc.owner_id)
                                      Filter: (is_active_user() AND ((id = current_profile_id()) OR has_permission('user.manage'::text) OR EXISTS(SubPlan 2)))
                                      Heap Fetches: 0
                                      SubPlan 2
                                        ->  Seq Scan on obligation_occurrences oc_1  (cost=0.00..60.15 rows=1 width=0) (never executed)
                                              Filter: (((owner_id = p.id) OR (validator_id = p.id)) AND is_active_user() AND (has_permission_in_domain('occurrence.read'::text, obligation_domain_of_type(obligation_type_id)) OR (owner_id = current_profile_id()) OR (validator_id = current_profile_id())) AND (has_permission_in_domain('occurrence.read'::text, obligation_domain_of_type(obligation_type_id)) OR (owner_id = current_profile_id()) OR (validator_id = current_profile_id())))
        ->  Memoize  (cost=0.15..69.08 rows=1 width=0) (never executed)
              Cache Key: oc.validator_id
              Cache Mode: binary
              ->  Subquery Scan on validator_profile  (cost=0.14..69.07 rows=1 width=0) (never executed)
                    ->  Limit  (cost=0.14..69.06 rows=1 width=32) (never executed)
                          ->  Index Only Scan using profiles_pkey on profiles p_1  (cost=0.14..69.06 rows=1 width=32) (never executed)
                                Index Cond: (id = oc.validator_id)
                                Filter: (is_active_user() AND ((id = current_profile_id()) OR has_permission('user.manage'::text) OR EXISTS(SubPlan 3)))
                                Heap Fetches: 0
                                SubPlan 3
                                  ->  Seq Scan on obligation_occurrences oc_2  (cost=0.00..60.15 rows=1 width=0) (never executed)
                                        Filter: (((owner_id = p_1.id) OR (validator_id = p_1.id)) AND is_active_user() AND (has_permission_in_domain('occurrence.read'::text, obligation_domain_of_type(obligation_type_id)) OR (owner_id = current_profile_id()) OR (validator_id = current_profile_id())) AND (has_permission_in_domain('occurrence.read'::text, obligation_domain_of_type(obligation_type_id)) OR (owner_id = current_profile_id()) OR (validator_id = current_profile_id())))
Planning:
  Buffers: shared hit=21
Planning Time: 0.880 ms
Execution Time: 2.574 ms
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
Limit  (cost=34.55..34.55 rows=1 width=32) (actual time=2.437..2.437 rows=0 loops=1)
  Buffers: shared hit=281
  ->  Sort  (cost=34.55..34.55 rows=1 width=32) (actual time=2.436..2.436 rows=0 loops=1)
        Sort Key: internal_due_date
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=281
        ->  Seq Scan on obligation_occurrences  (cost=0.00..34.54 rows=1 width=32) (actual time=2.435..2.435 rows=0 loops=1)
              Filter: ((deleted_at IS NULL) AND is_active_user() AND (has_permission_in_domain('occurrence.read'::text, obligation_domain_of_type(obligation_type_id)) OR (owner_id = current_profile_id()) OR (validator_id = current_profile_id())) AND (owner_id = (COALESCE(NULLIF(current_setting('request.jwt.claim.sub'::text, true), ''::text), ((NULLIF(current_setting('request.jwt.claims'::text, true), ''::text))::jsonb ->> 'sub'::text)))::uuid))
              Rows Removed by Filter: 14
              Buffers: shared hit=281
Planning:
  Buffers: shared hit=4
Planning Time: 0.232 ms
Execution Time: 2.446 ms
```

### File de validation

Les dossiers en attente de MA validation.

```sql
select count(*) from public.obligation_occurrences
          where status = 'PENDING_VALIDATION' and deleted_at is null
```

```
Aggregate  (cost=11.96..11.97 rows=1 width=8) (actual time=2.618..2.618 rows=1 loops=1)
  Buffers: shared hit=282
  ->  Index Scan using obligation_occurrences_open_due_idx on obligation_occurrences  (cost=0.14..11.95 rows=2 width=0) (actual time=2.617..2.617 rows=0 loops=1)
        Filter: ((deleted_at IS NULL) AND is_active_user() AND (has_permission_in_domain('occurrence.read'::text, obligation_domain_of_type(obligation_type_id)) OR (owner_id = current_profile_id()) OR (validator_id = current_profile_id())) AND (status = 'PENDING_VALIDATION'::occurrence_status))
        Rows Removed by Filter: 14
        Buffers: shared hit=282
Planning:
  Buffers: shared hit=7
Planning Time: 0.215 ms
Execution Time: 2.637 ms
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
Nested Loop Left Join  (cost=11.44..38.82 rows=1 width=42) (actual time=2.544..2.545 rows=0 loops=1)
  Join Filter: (d.checklist_item_id = ci.id)
  Buffers: shared hit=281
  ->  Nested Loop  (cost=11.44..38.81 rows=1 width=26) (actual time=2.544..2.544 rows=0 loops=1)
        Buffers: shared hit=281
        ->  HashAggregate  (cost=11.30..11.31 rows=1 width=16) (actual time=2.543..2.544 rows=0 loops=1)
              Group Key: obligation_occurrences.id
              Batches: 1  Memory Usage: 24kB
              Buffers: shared hit=281
              ->  Limit  (cost=0.00..11.30 rows=1 width=16) (actual time=2.543..2.543 rows=0 loops=1)
                    Buffers: shared hit=281
                    ->  Seq Scan on obligation_occurrences  (cost=0.00..33.89 rows=3 width=16) (actual time=2.542..2.542 rows=0 loops=1)
                          Filter: (is_active_user() AND (has_permission_in_domain('occurrence.read'::text, obligation_domain_of_type(obligation_type_id)) OR (owner_id = current_profile_id()) OR (validator_id = current_profile_id())))
                          Rows Removed by Filter: 14
                          Buffers: shared hit=281
        ->  Index Scan using occurrence_checklist_items_occurrence_idx on occurrence_checklist_items ci  (cost=0.14..27.49 rows=1 width=42) (never executed)
              Index Cond: (occurrence_id = obligation_occurrences.id)
              Filter: (is_active_user() AND EXISTS(SubPlan 1))
              SubPlan 1
                ->  Index Scan using obligation_occurrences_pkey on obligation_occurrences oc  (cost=0.14..9.41 rows=1 width=0) (never executed)
                      Index Cond: (id = ci.occurrence_id)
                      Filter: (is_active_user() AND (has_permission_in_domain('occurrence.read'::text, obligation_domain_of_type(obligation_type_id)) OR (owner_id = current_profile_id()) OR (validator_id = current_profile_id())))
  ->  Seq Scan on documents d  (cost=0.00..0.00 rows=1 width=32) (never executed)
        Filter: ((deleted_at IS NULL) AND (deleted_at IS NULL) AND is_active_user() AND has_permission_in_domain('document.read'::text, obligation_domain_of_occurrence(occurrence_id)) AND EXISTS(SubPlan 3))
        SubPlan 3
          ->  Index Scan using obligation_occurrences_pkey on obligation_occurrences oc_1  (cost=0.14..9.41 rows=1 width=0) (never executed)
                Index Cond: (id = d.occurrence_id)
                Filter: (is_active_user() AND (has_permission_in_domain('occurrence.read'::text, obligation_domain_of_type(obligation_type_id)) OR (owner_id = current_profile_id()) OR (validator_id = current_profile_id())))
Planning:
  Buffers: shared hit=267
Planning Time: 1.157 ms
Execution Time: 2.570 ms
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
Limit  (cost=0.01..0.02 rows=1 width=58) (actual time=0.006..0.006 rows=0 loops=1)
  ->  Sort  (cost=0.01..0.02 rows=1 width=58) (actual time=0.005..0.006 rows=0 loops=1)
        Sort Key: documents.uploaded_at DESC
        Sort Method: quicksort  Memory: 25kB
        ->  Seq Scan on documents  (cost=0.00..0.00 rows=1 width=58) (actual time=0.003..0.003 rows=0 loops=1)
              Filter: ((deleted_at IS NULL) AND (deleted_at IS NULL) AND is_active_user() AND has_permission_in_domain('document.read'::text, obligation_domain_of_occurrence(occurrence_id)) AND EXISTS(SubPlan 1))
              SubPlan 1
                ->  Index Scan using obligation_occurrences_pkey on obligation_occurrences oc  (cost=0.14..9.41 rows=1 width=0) (never executed)
                      Index Cond: (id = documents.occurrence_id)
                      Filter: (is_active_user() AND (has_permission_in_domain('occurrence.read'::text, obligation_domain_of_type(obligation_type_id)) OR (owner_id = current_profile_id()) OR (validator_id = current_profile_id())))
Planning:
  Buffers: shared hit=20
Planning Time: 0.471 ms
Execution Time: 0.018 ms
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
Limit  (cost=9.54..9.54 rows=1 width=35) (actual time=0.572..0.573 rows=1 loops=1)
  Buffers: shared hit=85
  ->  Sort  (cost=9.54..9.54 rows=1 width=35) (actual time=0.571..0.572 rows=1 loops=1)
        Sort Key: obligation_types.code
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=85
        ->  Seq Scan on obligation_types  (cost=7.77..9.53 rows=1 width=35) (actual time=0.563..0.564 rows=1 loops=1)
              Filter: ((deleted_at IS NULL) AND is_active_user() AND (is_admin() OR (has_permission('obligation.read'::text) AND ((domain_id IS NULL) OR (ANY (domain_id = (hashed SubPlan 1).col1))))))
              Buffers: shared hit=82
              SubPlan 1
                ->  ProjectSet  (cost=0.00..5.27 rows=1000 width=16) (never executed)
                      ->  Result  (cost=0.00..0.01 rows=1 width=0) (never executed)
Planning:
  Buffers: shared hit=34
Planning Time: 0.119 ms
Execution Time: 0.598 ms
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
Limit  (cost=1.01..1.01 rows=1 width=37) (actual time=0.011..0.012 rows=0 loops=1)
  Buffers: shared hit=1
  ->  Sort  (cost=1.01..1.01 rows=1 width=37) (actual time=0.011..0.011 rows=0 loops=1)
        Sort Key: created_at DESC
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=1
        ->  Seq Scan on notifications  (cost=0.00..1.00 rows=1 width=37) (actual time=0.008..0.008 rows=0 loops=1)
              Filter: ((read_at IS NULL) AND is_active_user() AND (recipient_id = current_profile_id()) AND (recipient_id = (COALESCE(NULLIF(current_setting('request.jwt.claim.sub'::text, true), ''::text), ((NULLIF(current_setting('request.jwt.claims'::text, true), ''::text))::jsonb ->> 'sub'::text)))::uuid))
              Buffers: shared hit=1
Planning:
  Buffers: shared hit=157
Planning Time: 0.487 ms
Execution Time: 0.020 ms
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
Limit  (cost=4.05..14.92 rows=50 width=57) (actual time=13.662..13.708 rows=50 loops=1)
  Buffers: shared hit=423
  ->  Append  (cost=4.05..2351.16 rows=10798 width=57) (actual time=13.661..13.704 rows=50 loops=1)
        Buffers: shared hit=423
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.706..0.706 rows=0 loops=1)
              One-Time Filter: (is_active_user() AND has_permission('audit.read'::text))
              Buffers: shared hit=15
              ->  Index Scan using audit_log_2028m10_occurred_at_idx on audit_log_2028m10 audit_log_27  (cost=0.14..47.00 rows=190 width=80) (actual time=0.002..0.003 rows=0 loops=1)
                    Buffers: shared hit=1
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.565..0.565 rows=0 loops=1)
              One-Time Filter: (is_active_user() AND has_permission('audit.read'::text))
              Buffers: shared hit=15
              ->  Index Scan using audit_log_2028m09_occurred_at_idx on audit_log_2028m09 audit_log_26  (cost=0.14..47.00 rows=190 width=80) (actual time=0.001..0.001 rows=0 loops=1)
                    Buffers: shared hit=1
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.521..0.521 rows=0 loops=1)
              One-Time Filter: (is_active_user() AND has_permission('audit.read'::text))
              Buffers: shared hit=15
              ->  Index Scan using audit_log_2028m08_occurred_at_idx on audit_log_2028m08 audit_log_25  (cost=0.14..47.00 rows=190 width=80) (actual time=0.002..0.002 rows=0 loops=1)
                    Buffers: shared hit=1
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.556..0.556 rows=0 loops=1)
              One-Time Filter: (is_active_user() AND has_permission('audit.read'::text))
              Buffers: shared hit=15
              ->  Index Scan using audit_log_2028m07_occurred_at_idx on audit_log_2028m07 audit_log_24  (cost=0.14..47.00 rows=190 width=80) (actual time=0.002..0.002 rows=0 loops=1)
                    Buffers: shared hit=1
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.482..0.482 rows=0 loops=1)
              One-Time Filter: (is_active_user() AND has_permission('audit.read'::text))
              Buffers: shared hit=15
              ->  Index Scan using audit_log_2028m06_occurred_at_idx on audit_log_2028m06 audit_log_23  (cost=0.14..47.00 rows=190 width=80) (actual time=0.001..0.001 rows=0 loops=1)
                    Buffers: shared hit=1
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.501..0.501 rows=0 loops=1)
              One-Time Filter: (is_active_user() AND has_permission('audit.read'::text))
              Buffers: shared hit=15
              ->  Index Scan using audit_log_2028m05_occurred_at_idx on audit_log_2028m05 audit_log_22  (cost=0.14..47.00 rows=190 width=80) (actual time=0.002..0.002 rows=0 loops=1)
                    Buffers: shared hit=1
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.533..0.533 rows=0 loops=1)
              One-Time Filter: (is_active_user() AND has_permission('audit.read'::text))
              Buffers: shared hit=15
              ->  Index Scan using audit_log_2028m04_occurred_at_idx on audit_log_2028m04 audit_log_21  (cost=0.14..47.00 rows=190 width=80) (actual time=0.002..0.002 rows=0 loops=1)
                    Buffers: shared hit=1
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.502..0.502 rows=0 loops=1)
              One-Time Filter: (is_active_user() AND has_permission('audit.read'::text))
              Buffers: shared hit=15
              ->  Index Scan using audit_log_2028m03_occurred_at_idx on audit_log_2028m03 audit_log_20  (cost=0.14..47.00 rows=190 width=80) (actual time=0.002..0.002 rows=0 loops=1)
                    Buffers: shared hit=1
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.527..0.528 rows=0 loops=1)
              One-Time Filter: (is_active_user() AND has_permission('audit.read'::text))
              Buffers: shared hit=15
              ->  Index Scan using audit_log_2028m02_occurred_at_idx on audit_log_2028m02 audit_log_19  (cost=0.14..47.00 rows=190 width=80) (actual time=0.002..0.002 rows=0 loops=1)
                    Buffers: shared hit=1
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.478..0.479 rows=0 loops=1)
              One-Time Filter: (is_active_user() AND has_permission('audit.read'::text))
              Buffers: shared hit=15
              ->  Index Scan using audit_log_2028m01_occurred_at_idx on audit_log_2028m01 audit_log_18  (cost=0.14..47.00 rows=190 width=80) (actual time=0.002..0.002 rows=0 loops=1)
                    Buffers: shared hit=1
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.516..0.517 rows=0 loops=1)
              One-Time Filter: (is_active_user() AND has_permission('audit.read'::text))
              Buffers: shared hit=15
              ->  Index Scan using audit_log_2027m12_occurred_at_idx on audit_log_2027m12 audit_log_17  (cost=0.14..47.00 rows=190 width=80) (actual time=0.002..0.002 rows=0 loops=1)
                    Buffers: shared hit=1
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.590..0.590 rows=0 loops=1)
              One-Time Filter: (is_active_user() AND has_permission('audit.read'::text))
              Buffers: shared hit=15
              ->  Index Scan using audit_log_2027m11_occurred_at_idx on audit_log_2027m11 audit_log_16  (cost=0.14..47.00 rows=190 width=80) (actual time=0.002..0.002 rows=0 loops=1)
                    Buffers: shared hit=1
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.518..0.518 rows=0 loops=1)
              One-Time Filter: (is_active_user() AND has_permission('audit.read'::text))
              Buffers: shared hit=15
              ->  Index Scan using audit_log_2027m10_occurred_at_idx on audit_log_2027m10 audit_log_15  (cost=0.14..47.00 rows=190 width=80) (actual time=0.002..0.002 rows=0 loops=1)
                    Buffers: shared hit=1
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.492..0.492 rows=0 loops=1)
              One-Time Filter: (is_active_user() AND has_permission('audit.read'::text))
              Buffers: shared hit=15
              ->  Index Scan using audit_log_2027m09_occurred_at_idx on audit_log_2027m09 audit_log_14  (cost=0.14..47.00 rows=190 width=80) (actual time=0.002..0.002 rows=0 loops=1)
                    Buffers: shared hit=1
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.525..0.526 rows=0 loops=1)
              One-Time Filter: (is_active_user() AND has_permission('audit.read'::text))
              Buffers: shared hit=15
              ->  Index Scan using audit_log_2027m08_occurred_at_idx on audit_log_2027m08 audit_log_13  (cost=0.14..47.00 rows=190 width=80) (actual time=0.002..0.002 rows=0 loops=1)
                    Buffers: shared hit=1
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.507..0.508 rows=0 loops=1)
              One-Time Filter: (is_active_user() AND has_permission('audit.read'::text))
              Buffers: shared hit=15
              ->  Index Scan using audit_log_2027m07_occurred_at_idx on audit_log_2027m07 audit_log_12  (cost=0.14..47.00 rows=190 width=80) (actual time=0.002..0.002 rows=0 loops=1)
                    Buffers: shared hit=1
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.495..0.495 rows=0 loops=1)
              One-Time Filter: (is_active_user() AND has_permission('audit.read'::text))
              Buffers: shared hit=15
              ->  Index Scan using audit_log_2027m06_occurred_at_idx on audit_log_2027m06 audit_log_11  (cost=0.14..47.00 rows=190 width=80) (actual time=0.002..0.002 rows=0 loops=1)
                    Buffers: shared hit=1
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.608..0.608 rows=0 loops=1)
              One-Time Filter: (is_active_user() AND has_permission('audit.read'::text))
              Buffers: shared hit=15
              ->  Index Scan using audit_log_2027m05_occurred_at_idx on audit_log_2027m05 audit_log_10  (cost=0.14..47.00 rows=190 width=80) (actual time=0.002..0.002 rows=0 loops=1)
                    Buffers: shared hit=1
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.547..0.548 rows=0 loops=1)
              One-Time Filter: (is_active_user() AND has_permission('audit.read'::text))
              Buffers: shared hit=15
              ->  Index Scan using audit_log_2027m04_occurred_at_idx on audit_log_2027m04 audit_log_9  (cost=0.14..47.00 rows=190 width=80) (actual time=0.003..0.003 rows=0 loops=1)
                    Buffers: shared hit=1
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.504..0.504 rows=0 loops=1)
              One-Time Filter: (is_active_user() AND has_permission('audit.read'::text))
              Buffers: shared hit=15
              ->  Index Scan using audit_log_2027m03_occurred_at_idx on audit_log_2027m03 audit_log_8  (cost=0.14..47.00 rows=190 width=80) (actual time=0.002..0.002 rows=0 loops=1)
                    Buffers: shared hit=1
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.473..0.474 rows=0 loops=1)
              One-Time Filter: (is_active_user() AND has_permission('audit.read'::text))
              Buffers: shared hit=15
              ->  Index Scan using audit_log_2027m02_occurred_at_idx on audit_log_2027m02 audit_log_7  (cost=0.14..47.00 rows=190 width=80) (actual time=0.002..0.002 rows=0 loops=1)
                    Buffers: shared hit=1
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.490..0.491 rows=0 loops=1)
              One-Time Filter: (is_active_user() AND has_permission('audit.read'::text))
              Buffers: shared hit=15
              ->  Index Scan using audit_log_2027m01_occurred_at_idx on audit_log_2027m01 audit_log_6  (cost=0.14..47.00 rows=190 width=80) (actual time=0.002..0.002 rows=0 loops=1)
                    Buffers: shared hit=1
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.524..0.525 rows=0 loops=1)
              One-Time Filter: (is_active_user() AND has_permission('audit.read'::text))
              Buffers: shared hit=15
              ->  Index Scan using audit_log_2026m12_occurred_at_idx on audit_log_2026m12 audit_log_5  (cost=0.14..47.00 rows=190 width=80) (actual time=0.002..0.002 rows=0 loops=1)
                    Buffers: shared hit=1
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.503..0.503 rows=0 loops=1)
              One-Time Filter: (is_active_user() AND has_permission('audit.read'::text))
              Buffers: shared hit=15
              ->  Index Scan using audit_log_2026m11_occurred_at_idx on audit_log_2026m11 audit_log_4  (cost=0.14..47.00 rows=190 width=80) (actual time=0.002..0.002 rows=0 loops=1)
                    Buffers: shared hit=1
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.482..0.483 rows=0 loops=1)
              One-Time Filter: (is_active_user() AND has_permission('audit.read'::text))
              Buffers: shared hit=15
              ->  Index Scan using audit_log_2026m10_occurred_at_idx on audit_log_2026m10 audit_log_3  (cost=0.14..47.00 rows=190 width=80) (actual time=0.002..0.002 rows=0 loops=1)
                    Buffers: shared hit=1
        ->  Result  (cost=0.28..1075.30 rows=5858 width=38) (actual time=0.505..0.533 rows=50 loops=1)
              One-Time Filter: (is_active_user() AND has_permission('audit.read'::text))
              Buffers: shared hit=48
              ->  Index Scan using audit_log_2026m09_occurred_at_idx on audit_log_2026m09 audit_log_2  (cost=0.28..1075.30 rows=5858 width=38) (actual time=0.025..0.051 rows=50 loops=1)
                    Buffers: shared hit=34
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (never executed)
              One-Time Filter: (is_active_user() AND has_permission('audit.read'::text))
              ->  Index Scan using audit_log_2026m08_occurred_at_idx on audit_log_2026m08 audit_log_1  (cost=0.14..47.00 rows=190 width=80) (never executed)
Planning:
  Buffers: shared hit=3819
Planning Time: 3.712 ms
Execution Time: 13.830 ms
```
