# Query plans

> Captured on 2026-09-27 by `node scripts/query-plans.ts`, against the local database.
> **Regenerate this file rather than editing it by hand.**

## How to read this document

Every plan was obtained **under a user session**, with `set local role authenticated`
and JWT claims set — so **RLS applied**. That is essential: the policies on
`obligation_occurrences` call `security definer` functions that PostgreSQL does
not inline. A plan captured as `postgres` ignores that cost and gives a false
picture, one or two orders of magnitude faster.

An execution time above **200 ms** is flagged. On the local database
the volumes are those of the development dataset: these figures serve to compare
plans against each other and to spot a sequential scan where an index exists, not
to predict production timings.

<!-- TENUE-EN-CHARGE:DEBUT -->
## Behaviour under load — fixing defect D-1

> Captured on **2026-09-03**, by hand, over **50,000 occurrences** of which
> **10,000 awaiting validation**, spread across 20 obligations and **two
> preparers**. Read by a **SUPERVISEUR account scoped to FISCAL**, with
> `set role authenticated` and JWT claims set — so RLS applied.
>
> WARNING: **this block is maintained by hand and preserved by
> `scripts/query-plans.ts`.** It does not regenerate: the "before" column no
> longer exists once the fix is applied.

### What was measured

Both columns were captured on **the same dataset, in the same table state** — the
fix was applied in place between the two passes. Both measurements therefore
carry the same bloat and the same distribution: the comparison owes nothing to a
more favourable reload.

Each query was read with `EXPLAIN (ANALYZE, BUFFERS)`. The queue returns **5,000
dossiers before and after**: it is the same answer, obtained differently.

| Query | Before | After | Buffer hits before | after |
| --- | ---: | ---: | ---: | ---: |
| **Validation queue** (`select *`) | **14,257 ms** | **57 ms** | **463,633** | **4,115** |
| Validation queue (`count`) | 11,914 ms | 14 ms | 459,992 | 1,693 |
| **Navigation badge** | **4,043 ms** | **14 ms** | **131,542** | **1,699** |
| Echeancier — first page | 9.6 ms | 1.0 ms | 453 | 90 |
| Dashboard aggregates | 1.6 ms | 1.2 ms | 119 | 125 |
| Alert banner | 11.7 ms | 12.3 ms | 2,954 | 3,171 |

The alert banner is the only line that does not improve. Measured five times in a
row it settles at **8.7-9.3 ms**: the 12.3 ms is a first pass under
`EXPLAIN ANALYZE` instrumentation, not a regression. There was nothing to gain
there — it queries live tables on an already indexed predicate.

### The cause, as the plan gave it

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

Everything inside a `Filter` is evaluated **once per row examined**. Three
distinct defects were layered there:

1. **`obligation_domain_of_type(obligation_type_id)`** reopened `obligation_types`
   for every dossier, even though a dossier's domain does not change during a
   query.
2. **No call was wrapped in a sub-select.** Including
   `domains_with_permission(...)`, introduced in 0012 precisely so it would be
   evaluated once: migration 0012 had fixed the *shape* without fixing the
   *number of evaluations*.
3. **The functions were `PARALLEL UNSAFE`** — PostgreSQL's default — which forbids
   any parallel plan on the whole query.

### The plan after the fix

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

Each authorisation term became an **`InitPlan`**, `rows=1 loops=1`: evaluated once
for the whole query. Several are `never executed` — the DIRECTION safety net does
not open for an account that does not fall under it. The nested loop over
`obligation_types` became a hash join.

### The three fixes

| Cause | Fix | Where |
| --- | --- | --- |
| Domain fetched per row | `obligation_occurrences.domain_id` column, set and realigned by trigger | 0019 SS2 |
| Function evaluated per row | `X = any ((select accessible_domains_array(p))::uuid[])` | 0019 SS3, SS5 |
| Parallel plan forbidden | `PARALLEL SAFE` on the 15 authorisation functions | 0019 SS3.2 |

WARNING: the `::uuid[]` cast is **load-bearing**. `any` has two forms, chosen by
syntax: `any (sub-select)` is the set form, which compares the column to the
sub-select's *rows* — that is, a `uuid` against a `uuid[]`, and a refusal when the
policy is created. The cast makes it an expression, hence the array form, while
leaving it uncorrelated.

### What keeps the fix in place

`tests/integration/dashboard-performance.test.ts`, marked `@slow`, rebuilds the
50,000 dossiers and checks **two** budgets: under 200 ms, and under 10,000 buffer
hits. The second assertion is the more useful one — time depends on the machine,
buffer hits do not, and a call that stopped being wrapped would show up there
before the stopwatch noticed.

`tests/integration/authorization-model.test.ts` verifies **structurally** that no
policy carries an unwrapped authorisation call, and that the fifteen functions
stay `STABLE PARALLEL SAFE`.

<!-- TENUE-EN-CHARGE:FIN -->

## Summary

| Query | Planning | Execution | Sequential scans |
| --- | ---: | ---: | ---: |
| Échéancier — première page | 2.40 ms | 4.62 ms | 2 |
| Échéancier — filtré par domaine et statut | 0.89 ms | 3.25 ms | 1 |
| Échéancier — page suivante (curseur) | 0.84 ms | 2.69 ms | 2 |
| Mes tâches | 0.16 ms | 0.83 ms | 1 |
| File de validation | 0.14 ms | 0.96 ms | 0 |
| Fiche d'un dossier — liste de contrôle | 0.85 ms | 1.91 ms | 3 |
| Documents — liste filtrée | 0.22 ms | 0.04 ms | 1 |
| Référentiel des obligations | 0.11 ms | 1.60 ms | 1 |
| Centre de notifications | 0.31 ms | 0.03 ms | 1 |
| Journal d'audit — dernière page | 4.51 ms | 0.72 ms | 0 |

No query above 200 ms on this dataset.

## Volumes at capture time

| Table | Rows (estimate) | Total size |
| --- | ---: | ---: |
| `audit_log_2026m09` | 87815 | 127 MB |
| `obligation_occurrences` | 89 | 27 MB |
| `occurrence_transitions` | 101 | 3256 kB |
| `notifications` | 0 | 328 kB |
| `documents` | 0 | 216 kB |
| `obligation_types` | 25 | 184 kB |
| `job_runs` | 111 | 168 kB |
| `auth_attempts` | 123 | 168 kB |
| `occurrence_checklist_items` | 260 | 160 kB |
| `commercial_registers` | 5 | 128 kB |
| `user_roles` | 1 | 112 kB |
| `document_upload_tickets` | 0 | 112 kB |
| `profiles` | 23 | 104 kB |
| `export_runs` | -1 | 80 kB |
| `document_integrity_checks` | -1 | 80 kB |

## The ten most frequent queries

Taken from `pg_stat_statements`, as-is. The queries there are **normalised**
(parameters replaced by `$1`): they are not replayable as they stand, hence
the explicit probes above.

| Calls | Mean | Total | Query |
| ---: | ---: | ---: | --- |
| 16043 | 0.01 ms | 232.3 ms | `select set_config('search_path', $1, true), set_config('role', $2, true), set_config('request.jwt.claims', $3, true), set_config('request.method', $4, true), se` |
| 11530 | 0.02 ms | 278.3 ms | `select set_config('search_path', $1, true), set_config($2, $3, true), set_config('role', $4, true), set_config('request.jwt.claims', $5, true), set_config('requ` |
| 4568 | 0.16 ms | 740.6 ms | `WITH pgrst_source AS (SELECT pgrst_call.pgrst_scalar FROM (SELECT $1 AS json_data) pgrst_payload, LATERAL (SELECT "p_recipient", "p_channel", "p_kind", "p_subje` |
| 4540 | 0.19 ms | 859.2 ms | `WITH pgrst_source AS (SELECT pgrst_call.pgrst_scalar FROM (SELECT $1 AS json_data) pgrst_payload, LATERAL (SELECT "p_recipient", "p_channel", "p_kind", "p_subje` |
| 2588 | 1.07 ms | 2764.1 ms | `WITH pgrst_source AS (SELECT pgrst_call.pgrst_scalar FROM (SELECT $1 AS json_data) pgrst_payload, LATERAL (SELECT "p_ip" FROM json_to_record(pgrst_payload.json_` |
| 1911 | 0.01 ms | 16.0 ms | `set local role authenticated` |
| 1436 | 0.15 ms | 210.1 ms | `WITH pgrst_source AS (SELECT pgrst_call.pgrst_scalar FROM (SELECT $1 AS json_data) pgrst_payload, LATERAL (SELECT "p_recipient", "p_channel", "p_kind", "p_subje` |
| 1428 | 0.20 ms | 279.4 ms | `WITH pgrst_source AS (SELECT pgrst_call.pgrst_scalar FROM (SELECT $1 AS json_data) pgrst_payload, LATERAL (SELECT "p_recipient", "p_channel", "p_kind", "p_subje` |
| 1428 | 0.52 ms | 746.0 ms | `WITH pgrst_source AS (SELECT pgrst_call.pgrst_scalar FROM (SELECT $1 AS json_data) pgrst_payload, LATERAL (SELECT "p_obligation_type_id", "p_period_key", "p_per` |
| 1258 | 0.00 ms | 1.1 ms | `rollback` |

## What this capture teaches

Three observations, in order of measured cost.

**1. `navigation_counters()` is the most expensive point in the application.**
Called on every page render — it feeds the sidebar counters — it dominates total
cumulative time even though no screen query comes near its mean. It is the first
place to look if pages slow down, before any business screen.


**2. The authentication context costs four round trips per render.**
`profiles`, `user_roles`, `role_permissions` and `validation_delegations` are read
separately. Grouping them into a single function is feasible and the gain would be
measurable — but it is NOT done here: an earlier attempt to factor out RLS
`security definer` functions took one counter from 92 ms to over 30 s, because
PostgreSQL then stops inlining. Any revisit of this point must be measured BEFORE
being adopted, not after.

**3. `session_gates` is called on every request, prefetches included.**
That is the price of the middleware guard, and it is accepted: the gate closes on
every request or it serves no purpose. Its mean stays low; it is the number of
calls that puts it at the top, not its unit cost.

None of these observations led to a rewrite in this phase. The times measured —
a few milliseconds — bear no relation to the platform's real volume (a few dozen
users), and changing an access path without a demonstrated gain would run a risk
greater than the benefit. This document exists so the decision can be revisited on
figures, the day it arises.


## Indexes never used

⚠️ **On a development database this table is almost meaningless**: the tables hold
a few dozen rows, and the planner then prefers a sequential scan to any index,
however relevant. To be re-read on a loaded database — only there does an
`idx_scan = 0` become a question.

An unused index costs on every write and returns nothing on reads.
**Read it carefully**: `idx_scan = 0` on a development database may simply mean
the corresponding screen was never opened. This table exists to raise the
question, not to decide a removal on its own.

| Table | Index | Scans | Size |
| --- | --- | ---: | ---: |
| `obligation_occurrences` | `obligation_occurrences_search_idx` | 0 | 3784 kB |
| `audit_log_2026m09` | `audit_log_2026m09_pkey` | 0 | 2784 kB |
| `obligation_occurrences` | `obligation_occurrences_entity_domain_status_idx` | 0 | 1336 kB |
| `audit_log_2026m09` | `audit_log_2026m09_actor_id_occurred_at_idx` | 0 | 872 kB |
| `occurrence_transitions` | `occurrence_transitions_pkey` | 0 | 472 kB |
| `obligation_types` | `obligation_types_search_idx` | 0 | 56 kB |
| `commercial_registers` | `commercial_registers_search_idx` | 0 | 24 kB |
| `documents` | `documents_search_idx` | 0 | 24 kB |
| `occurrence_stats` | `occurrence_stats_key_idx` | 0 | 16 kB |
| `profiles` | `profiles_ics_token_key` | 0 | 16 kB |
| `calendar_feed_tokens` | `calendar_feed_tokens_token_key` | 0 | 16 kB |
| `user_invitations` | `user_invitations_pending_idx` | 0 | 16 kB |
| `document_access_log_2026m09` | `document_access_log_2026m09_pkey` | 0 | 16 kB |
| `dashboard_compliance_monthly` | `dashboard_compliance_monthly_key_idx` | 0 | 16 kB |
| `dashboard_upcoming_load` | `dashboard_upcoming_load_key_idx` | 0 | 16 kB |
| `document_upload_tickets` | `document_upload_tickets_storage_path_key` | 0 | 16 kB |
| `notification_rules` | `notification_rules_lookup_idx` | 0 | 16 kB |
| `obligation_occurrences` | `obligation_occurrences_deputy_idx` | 0 | 16 kB |
| `user_absences` | `user_absences_pkey` | 0 | 16 kB |
| `status_transition_rules` | `status_transition_rules_pkey` | 0 | 16 kB |
| `restore_tests` | `restore_tests_recent_idx` | 0 | 16 kB |
| `obligation_types` | `obligation_types_entity_domain_idx` | 0 | 16 kB |
| `job_runs` | `job_runs_unfinished_idx` | 0 | 16 kB |
| `user_invitations` | `user_invitations_pkey` | 0 | 16 kB |
| `notifications` | `notifications_unread_idx` | 0 | 16 kB |
| `commercial_registers` | `commercial_registers_single_principal_idx` | 0 | 16 kB |
| `documents` | `documents_sha256_idx` | 0 | 16 kB |
| `transition_notifications` | `transition_notifications_pkey` | 0 | 16 kB |
| `auth_attempts` | `auth_attempts_email_idx` | 0 | 16 kB |
| `document_access_log_2026m09` | `document_access_log_2026m09_actor_id_created_at_idx` | 0 | 16 kB |
| `backup_runs` | `backup_runs_recent_idx` | 0 | 16 kB |
| `obligation_occurrences` | `obligation_occurrences_rectification_idx` | 0 | 16 kB |
| `document_integrity_checks` | `document_integrity_checks_run_idx` | 0 | 16 kB |
| `notification_rules` | `notification_rules_pkey` | 0 | 16 kB |
| `restore_tests` | `restore_tests_pkey` | 0 | 16 kB |
| `auth_attempts` | `auth_attempts_pkey` | 0 | 16 kB |
| `escalation_policies` | `escalation_policies_lookup_idx` | 0 | 16 kB |
| `rate_limit_hits` | `rate_limit_hits_pkey` | 0 | 16 kB |
| `profiles` | `profiles_email_key` | 0 | 16 kB |
| `dashboard_late_reasons` | `dashboard_late_reasons_key_idx` | 0 | 16 kB |

## Detailed plans

### Échéancier — première page

La liste de travail quotidienne, triée par échéance interne.

```sql
select id, period_key, status, internal_due_date, legal_due_date
          from public.occurrence_list
          order by internal_due_date asc, id asc
          limit 25
```

```
Limit  (cost=25.89..25.91 rows=8 width=34) (actual time=4.307..4.318 rows=25 loops=1)
  Buffers: shared hit=509
  InitPlan 1
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.335..0.335 rows=1 loops=1)
          Buffers: shared hit=73
  InitPlan 2
    ->  Result  (cost=0.00..0.26 rows=1 width=32) (actual time=1.808..1.808 rows=1 loops=1)
          Buffers: shared hit=309
  InitPlan 3
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  InitPlan 4
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  InitPlan 5
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  InitPlan 6
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.091..0.092 rows=1 loops=1)
          Buffers: shared hit=2
  InitPlan 7
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.274..0.274 rows=1 loops=1)
          Buffers: shared hit=84
  InitPlan 8
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.533..0.534 rows=1 loops=1)
          Buffers: shared hit=7
  InitPlan 9
    ->  Result  (cost=0.00..0.26 rows=1 width=32) (actual time=0.875..0.875 rows=1 loops=1)
          Buffers: shared hit=8
  InitPlan 10
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.140..0.140 rows=1 loops=1)
          Buffers: shared hit=2
  InitPlan 11
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 12
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 13
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  InitPlan 14
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 25
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 26
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  InitPlan 27
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 38
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 39
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  InitPlan 40
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 51
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 52
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  ->  Sort  (cost=20.17..20.19 rows=8 width=34) (actual time=4.304..4.306 rows=25 loops=1)
        Sort Key: oc.internal_due_date, oc.id
        Sort Method: top-N heapsort  Memory: 27kB
        Buffers: shared hit=509
        ->  Nested Loop  (cost=2.83..20.05 rows=8 width=34) (actual time=4.175..4.249 rows=89 loops=1)
              Buffers: shared hit=503
              ->  Hash Join  (cost=2.67..13.48 rows=15 width=50) (actual time=4.014..4.062 rows=89 loops=1)
                    Hash Cond: (oc.obligation_type_id = ot.id)
                    Buffers: shared hit=493
                    ->  Seq Scan on obligation_occurrences oc  (cost=0.00..10.67 rows=42 width=130) (actual time=2.168..2.195 rows=89 loops=1)
                          Filter: ((InitPlan 1).col1 AND (deleted_at IS NULL) AND ((domain_id = ANY ((InitPlan 2).col1)) OR (owner_id = (InitPlan 3).col1) OR (deputy_id = (InitPlan 4).col1) OR (validator_id = (InitPlan 5).col1)))
                          Buffers: shared hit=390
                    ->  Hash  (cost=2.56..2.56 rows=9 width=32) (actual time=1.798..1.798 rows=23 loops=1)
                          Buckets: 1024  Batches: 1  Memory Usage: 10kB
                          Buffers: shared hit=103
                          ->  Seq Scan on obligation_types ot  (cost=0.00..2.56 rows=9 width=32) (actual time=1.787..1.793 rows=23 loops=1)
                                Filter: ((InitPlan 6).col1 AND ((InitPlan 7).col1 OR ((InitPlan 8).col1 AND (domain_id = ANY ((InitPlan 9).col1)))))
                                Buffers: shared hit=103
              ->  Memoize  (cost=0.16..1.32 rows=1 width=16) (actual time=0.002..0.002 rows=1 loops=89)
                    Cache Key: oc.domain_id
                    Cache Mode: logical
                    Hits: 85  Misses: 4  Evictions: 0  Overflows: 0  Memory Usage: 1kB
                    Buffers: shared hit=10
                    ->  Index Only Scan using domains_pkey on domains dom  (cost=0.15..1.31 rows=1 width=16) (actual time=0.040..0.040 rows=1 loops=4)
                          Index Cond: (id = oc.domain_id)
                          Filter: (InitPlan 10).col1
                          Heap Fetches: 4
                          Buffers: shared hit=10
Planning:
  Buffers: shared hit=847
Planning Time: 2.404 ms
Execution Time: 4.622 ms
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
Limit  (cost=22.65..22.67 rows=8 width=30) (actual time=3.132..3.140 rows=25 loops=1)
  Buffers: shared hit=119
  InitPlan 1
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.145..0.146 rows=1 loops=1)
          Buffers: shared hit=2
  InitPlan 2
    ->  Result  (cost=0.00..0.26 rows=1 width=32) (actual time=0.863..0.863 rows=1 loops=1)
          Buffers: shared hit=10
  InitPlan 3
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  InitPlan 4
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  InitPlan 5
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  InitPlan 6
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.108..0.109 rows=1 loops=1)
          Buffers: shared hit=2
  InitPlan 7
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.168..0.168 rows=1 loops=1)
          Buffers: shared hit=3
  InitPlan 8
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.611..0.611 rows=1 loops=1)
          Buffers: shared hit=7
  InitPlan 9
    ->  Result  (cost=0.00..0.26 rows=1 width=32) (actual time=0.875..0.875 rows=1 loops=1)
          Buffers: shared hit=8
  InitPlan 10
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.105..0.105 rows=1 loops=1)
          Buffers: shared hit=2
  InitPlan 11
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 12
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 13
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  InitPlan 14
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 25
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 26
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  InitPlan 27
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 38
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 39
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  InitPlan 40
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 51
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 52
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  ->  Sort  (cost=16.93..16.95 rows=8 width=30) (actual time=3.131..3.133 rows=25 loops=1)
        Sort Key: oc.internal_due_date, oc.id
        Sort Method: top-N heapsort  Memory: 26kB
        Buffers: shared hit=119
        ->  Nested Loop  (cost=3.10..16.81 rows=8 width=30) (actual time=2.922..3.114 rows=89 loops=1)
              Buffers: shared hit=119
              ->  Hash Join  (cost=2.94..10.24 rows=15 width=46) (actual time=2.807..2.975 rows=89 loops=1)
                    Hash Cond: (oc.obligation_type_id = ot.id)
                    Buffers: shared hit=109
                    ->  Index Scan using obligation_occurrences_calendar_idx on obligation_occurrences oc  (cost=0.27..7.43 rows=42 width=126) (actual time=1.024..1.180 rows=89 loops=1)
                          Filter: ((InitPlan 1).col1 AND ((domain_id = ANY ((InitPlan 2).col1)) OR (owner_id = (InitPlan 3).col1) OR (deputy_id = (InitPlan 4).col1) OR (validator_id = (InitPlan 5).col1)) AND (status = ANY ('{TODO,IN_PROGRESS,PENDING_VALIDATION}'::occurrence_status[])))
                          Buffers: shared hit=87
                    ->  Hash  (cost=2.56..2.56 rows=9 width=32) (actual time=1.781..1.781 rows=23 loops=1)
                          Buckets: 1024  Batches: 1  Memory Usage: 10kB
                          Buffers: shared hit=22
                          ->  Seq Scan on obligation_types ot  (cost=0.00..2.56 rows=9 width=32) (actual time=1.770..1.776 rows=23 loops=1)
                                Filter: ((InitPlan 6).col1 AND ((InitPlan 7).col1 OR ((InitPlan 8).col1 AND (domain_id = ANY ((InitPlan 9).col1)))))
                                Buffers: shared hit=22
              ->  Memoize  (cost=0.16..1.32 rows=1 width=16) (actual time=0.001..0.001 rows=1 loops=89)
                    Cache Key: oc.domain_id
                    Cache Mode: logical
                    Hits: 85  Misses: 4  Evictions: 0  Overflows: 0  Memory Usage: 1kB
                    Buffers: shared hit=10
                    ->  Index Only Scan using domains_pkey on domains dom  (cost=0.15..1.31 rows=1 width=16) (actual time=0.028..0.028 rows=1 loops=4)
                          Index Cond: (id = oc.domain_id)
                          Filter: (InitPlan 10).col1
                          Heap Fetches: 4
                          Buffers: shared hit=10
Planning:
  Buffers: shared hit=36
Planning Time: 0.886 ms
Execution Time: 3.249 ms
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
Limit  (cost=27.11..27.13 rows=6 width=30) (actual time=2.558..2.566 rows=25 loops=1)
  Buffers: shared hit=52
  InitPlan 1
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.155..0.155 rows=1 loops=1)
          Buffers: shared hit=2
  InitPlan 2
    ->  Result  (cost=0.00..0.26 rows=1 width=32) (actual time=0.776..0.776 rows=1 loops=1)
          Buffers: shared hit=10
  InitPlan 3
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  InitPlan 4
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  InitPlan 5
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  InitPlan 6
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.127..0.127 rows=1 loops=1)
          Buffers: shared hit=2
  InitPlan 7
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.173..0.173 rows=1 loops=1)
          Buffers: shared hit=3
  InitPlan 8
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.393..0.393 rows=1 loops=1)
          Buffers: shared hit=7
  InitPlan 9
    ->  Result  (cost=0.00..0.26 rows=1 width=32) (actual time=0.759..0.759 rows=1 loops=1)
          Buffers: shared hit=8
  InitPlan 10
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.069..0.069 rows=1 loops=1)
          Buffers: shared hit=2
  InitPlan 11
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 12
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 13
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  InitPlan 14
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 25
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 26
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  InitPlan 27
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 38
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 39
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  InitPlan 40
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 51
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 52
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  ->  Sort  (cost=21.39..21.41 rows=6 width=30) (actual time=2.557..2.559 rows=25 loops=1)
        Sort Key: oc.internal_due_date, oc.id
        Sort Method: top-N heapsort  Memory: 27kB
        Buffers: shared hit=52
        ->  Nested Loop  (cost=2.83..21.31 rows=6 width=30) (actual time=2.493..2.541 rows=78 loops=1)
              Buffers: shared hit=52
              ->  Hash Join  (cost=2.67..14.12 rows=13 width=46) (actual time=2.416..2.445 rows=78 loops=1)
                    Hash Cond: (oc.obligation_type_id = ot.id)
                    Buffers: shared hit=42
                    ->  Seq Scan on obligation_occurrences oc  (cost=0.00..11.34 rows=37 width=126) (actual time=0.944..0.964 rows=78 loops=1)
                          Filter: ((InitPlan 1).col1 AND (deleted_at IS NULL) AND (ROW(internal_due_date, id) > ROW(CURRENT_DATE, '00000000-0000-0000-0000-000000000000'::uuid)) AND ((domain_id = ANY ((InitPlan 2).col1)) OR (owner_id = (InitPlan 3).col1) OR (deputy_id = (InitPlan 4).col1) OR (validator_id = (InitPlan 5).col1)))
                          Rows Removed by Filter: 11
                          Buffers: shared hit=20
                    ->  Hash  (cost=2.56..2.56 rows=9 width=32) (actual time=1.469..1.470 rows=23 loops=1)
                          Buckets: 1024  Batches: 1  Memory Usage: 10kB
                          Buffers: shared hit=22
                          ->  Seq Scan on obligation_types ot  (cost=0.00..2.56 rows=9 width=32) (actual time=1.459..1.465 rows=23 loops=1)
                                Filter: ((InitPlan 6).col1 AND ((InitPlan 7).col1 OR ((InitPlan 8).col1 AND (domain_id = ANY ((InitPlan 9).col1)))))
                                Buffers: shared hit=22
              ->  Memoize  (cost=0.16..1.47 rows=1 width=16) (actual time=0.001..0.001 rows=1 loops=78)
                    Cache Key: oc.domain_id
                    Cache Mode: logical
                    Hits: 74  Misses: 4  Evictions: 0  Overflows: 0  Memory Usage: 1kB
                    Buffers: shared hit=10
                    ->  Index Only Scan using domains_pkey on domains dom  (cost=0.15..1.46 rows=1 width=16) (actual time=0.019..0.019 rows=1 loops=4)
                          Index Cond: (id = oc.domain_id)
                          Filter: (InitPlan 10).col1
                          Heap Fetches: 4
                          Buffers: shared hit=10
Planning:
  Buffers: shared hit=8
Planning Time: 0.836 ms
Execution Time: 2.687 ms
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
Limit  (cost=14.21..14.21 rows=1 width=30) (actual time=0.810..0.811 rows=0 loops=1)
  Buffers: shared hit=20
  InitPlan 1
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.078..0.078 rows=1 loops=1)
          Buffers: shared hit=2
  InitPlan 2
    ->  Result  (cost=0.00..0.26 rows=1 width=32) (actual time=0.652..0.652 rows=1 loops=1)
          Buffers: shared hit=10
  InitPlan 3
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  InitPlan 4
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  InitPlan 5
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  ->  Sort  (cost=12.90..12.91 rows=1 width=30) (actual time=0.810..0.810 rows=0 loops=1)
        Sort Key: obligation_occurrences.internal_due_date
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=20
        ->  Seq Scan on obligation_occurrences  (cost=0.00..12.89 rows=1 width=30) (actual time=0.808..0.808 rows=0 loops=1)
              Filter: ((InitPlan 1).col1 AND (deleted_at IS NULL) AND ((domain_id = ANY ((InitPlan 2).col1)) OR (owner_id = (InitPlan 3).col1) OR (deputy_id = (InitPlan 4).col1) OR (validator_id = (InitPlan 5).col1)) AND (owner_id = (COALESCE(NULLIF(current_setting('request.jwt.claim.sub'::text, true), ''::text), ((NULLIF(current_setting('request.jwt.claims'::text, true), ''::text))::jsonb ->> 'sub'::text)))::uuid))
              Rows Removed by Filter: 89
              Buffers: shared hit=20
Planning:
  Buffers: shared hit=1
Planning Time: 0.158 ms
Execution Time: 0.830 ms
```

### File de validation

Les dossiers en attente de MA validation.

```sql
select count(*) from public.obligation_occurrences
          where status = 'PENDING_VALIDATION' and deleted_at is null
```

```
Aggregate  (cost=8.83..8.84 rows=1 width=8) (actual time=0.935..0.936 rows=1 loops=1)
  Buffers: shared hit=87
  InitPlan 1
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.097..0.097 rows=1 loops=1)
          Buffers: shared hit=2
  InitPlan 2
    ->  Result  (cost=0.00..0.26 rows=1 width=32) (actual time=0.770..0.770 rows=1 loops=1)
          Buffers: shared hit=10
  InitPlan 3
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  InitPlan 4
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  InitPlan 5
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  ->  Index Scan using obligation_occurrences_calendar_idx on obligation_occurrences  (cost=0.27..7.43 rows=42 width=0) (actual time=0.934..0.934 rows=0 loops=1)
        Filter: ((InitPlan 1).col1 AND ((domain_id = ANY ((InitPlan 2).col1)) OR (owner_id = (InitPlan 3).col1) OR (deputy_id = (InitPlan 4).col1) OR (validator_id = (InitPlan 5).col1)) AND (status = 'PENDING_VALIDATION'::occurrence_status))
        Rows Removed by Filter: 89
        Buffers: shared hit=87
Planning:
  Buffers: shared hit=4
Planning Time: 0.143 ms
Execution Time: 0.957 ms
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
Nested Loop Left Join  (cost=6.76..61.09 rows=1 width=55) (actual time=1.841..1.848 rows=2 loops=1)
  Buffers: shared hit=46
  InitPlan 1
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.071..0.071 rows=1 loops=1)
          Buffers: shared hit=2
  InitPlan 14
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 15
    ->  Result  (cost=0.00..0.26 rows=1 width=32) (never executed)
  ->  Nested Loop  (cost=5.85..47.52 rows=1 width=39) (actual time=1.832..1.837 rows=2 loops=1)
        Buffers: shared hit=44
        ->  HashAggregate  (cost=1.56..1.57 rows=1 width=16) (actual time=1.001..1.003 rows=1 loops=1)
              Group Key: obligation_occurrences.id
              Batches: 1  Memory Usage: 24kB
              Buffers: shared hit=19
              ->  Limit  (cost=1.30..1.55 rows=1 width=16) (actual time=0.999..1.001 rows=1 loops=1)
                    Buffers: shared hit=19
                    InitPlan 28
                      ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.098..0.098 rows=1 loops=1)
                            Buffers: shared hit=2
                    InitPlan 29
                      ->  Result  (cost=0.00..0.26 rows=1 width=32) (actual time=0.890..0.891 rows=1 loops=1)
                            Buffers: shared hit=10
                    InitPlan 30
                      ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                    InitPlan 31
                      ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                    InitPlan 32
                      ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                    ->  Seq Scan on obligation_occurrences  (cost=0.00..10.67 rows=42 width=16) (actual time=0.999..0.999 rows=1 loops=1)
                          Filter: ((InitPlan 28).col1 AND ((domain_id = ANY ((InitPlan 29).col1)) OR (owner_id = (InitPlan 30).col1) OR (deputy_id = (InitPlan 31).col1) OR (validator_id = (InitPlan 32).col1)))
                          Buffers: shared hit=19
        ->  Bitmap Heap Scan on occurrence_checklist_items ci  (cost=4.30..45.94 rows=1 width=55) (actual time=0.829..0.831 rows=2 loops=1)
              Recheck Cond: (occurrence_id = obligation_occurrences.id)
              Filter: ((InitPlan 1).col1 AND (ANY (occurrence_id = (hashed SubPlan 13).col1)))
              Heap Blocks: exact=1
              Buffers: shared hit=25
              ->  Bitmap Index Scan on occurrence_checklist_items_occurrence_idx  (cost=0.00..4.29 rows=3 width=0) (actual time=0.014..0.014 rows=2 loops=1)
                    Index Cond: (occurrence_id = obligation_occurrences.id)
                    Buffers: shared hit=2
              SubPlan 13
                ->  Seq Scan on obligation_occurrences oc  (cost=1.30..11.97 rows=42 width=16) (actual time=0.710..0.727 rows=89 loops=1)
                      Filter: ((InitPlan 8).col1 AND ((domain_id = ANY ((InitPlan 9).col1)) OR (owner_id = (InitPlan 10).col1) OR (deputy_id = (InitPlan 11).col1) OR (validator_id = (InitPlan 12).col1)))
                      Buffers: shared hit=20
                      InitPlan 8
                        ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.046..0.046 rows=1 loops=1)
                              Buffers: shared hit=2
                      InitPlan 9
                        ->  Result  (cost=0.00..0.26 rows=1 width=32) (actual time=0.657..0.657 rows=1 loops=1)
                              Buffers: shared hit=10
                      InitPlan 10
                        ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                      InitPlan 11
                        ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
                      InitPlan 12
                        ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  ->  Index Scan using documents_checklist_item_idx on documents d  (cost=0.12..12.78 rows=1 width=32) (actual time=0.004..0.004 rows=0 loops=2)
        Index Cond: (checklist_item_id = ci.id)
        Filter: ((InitPlan 14).col1 AND (obligation_domain_of_occurrence(occurrence_id) = ANY ((InitPlan 15).col1)) AND (ANY (occurrence_id = (hashed SubPlan 27).col1)))
        Buffers: shared hit=2
        SubPlan 27
          ->  Seq Scan on obligation_occurrences oc_1  (cost=1.30..11.97 rows=42 width=16) (never executed)
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
  Buffers: shared hit=281
Planning Time: 0.854 ms
Execution Time: 1.914 ms
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
Limit  (cost=0.65..21.11 rows=1 width=88) (actual time=0.011..0.012 rows=0 loops=1)
  Buffers: shared hit=1
  InitPlan 1
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 2
    ->  Result  (cost=0.00..0.26 rows=1 width=32) (never executed)
  ->  Index Scan Backward using documents_uploaded_at_idx on documents  (cost=0.12..20.59 rows=1 width=88) (actual time=0.010..0.011 rows=0 loops=1)
        Filter: ((InitPlan 1).col1 AND (obligation_domain_of_occurrence(occurrence_id) = ANY ((InitPlan 2).col1)) AND (ANY (occurrence_id = (hashed SubPlan 14).col1)))
        Buffers: shared hit=1
        SubPlan 14
          ->  Seq Scan on obligation_occurrences oc  (cost=1.30..11.97 rows=42 width=16) (never executed)
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
  Buffers: shared hit=7
Planning Time: 0.223 ms
Execution Time: 0.045 ms
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
Limit  (cost=3.75..3.77 rows=9 width=79) (actual time=1.568..1.571 rows=23 loops=1)
  Buffers: shared hit=25
  InitPlan 1
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.115..0.115 rows=1 loops=1)
          Buffers: shared hit=2
  InitPlan 2
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.239..0.239 rows=1 loops=1)
          Buffers: shared hit=3
  InitPlan 3
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.466..0.466 rows=1 loops=1)
          Buffers: shared hit=7
  InitPlan 4
    ->  Result  (cost=0.00..0.26 rows=1 width=32) (actual time=0.714..0.714 rows=1 loops=1)
          Buffers: shared hit=8
  ->  Sort  (cost=2.71..2.73 rows=9 width=79) (actual time=1.568..1.568 rows=23 loops=1)
        Sort Key: obligation_types.code
        Sort Method: quicksort  Memory: 28kB
        Buffers: shared hit=25
        ->  Seq Scan on obligation_types  (cost=0.00..2.56 rows=9 width=79) (actual time=1.543..1.550 rows=23 loops=1)
              Filter: ((InitPlan 1).col1 AND (deleted_at IS NULL) AND ((InitPlan 2).col1 OR ((InitPlan 3).col1 AND (domain_id = ANY ((InitPlan 4).col1)))))
              Buffers: shared hit=22
Planning:
  Buffers: shared hit=30
Planning Time: 0.112 ms
Execution Time: 1.604 ms
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
Limit  (cost=1.53..1.53 rows=1 width=31) (actual time=0.011..0.012 rows=0 loops=1)
  Buffers: shared hit=1
  InitPlan 1
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (never executed)
  InitPlan 2
    ->  Result  (cost=0.00..0.26 rows=1 width=16) (never executed)
  ->  Sort  (cost=1.01..1.01 rows=1 width=31) (actual time=0.011..0.011 rows=0 loops=1)
        Sort Key: notifications.created_at DESC
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=1
        ->  Seq Scan on notifications  (cost=0.00..1.00 rows=1 width=31) (actual time=0.008..0.008 rows=0 loops=1)
              Filter: ((InitPlan 1).col1 AND (read_at IS NULL) AND (recipient_id = (InitPlan 2).col1) AND (recipient_id = (COALESCE(NULLIF(current_setting('request.jwt.claim.sub'::text, true), ''::text), ((NULLIF(current_setting('request.jwt.claims'::text, true), ''::text))::jsonb ->> 'sub'::text)))::uuid))
              Buffers: shared hit=1
Planning:
  Buffers: shared hit=151
Planning Time: 0.307 ms
Execution Time: 0.029 ms
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
Limit  (cost=4.58..14.58 rows=50 width=47) (actual time=0.618..0.623 rows=0 loops=1)
  Buffers: shared hit=31
  InitPlan 1
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.180..0.181 rows=1 loops=1)
          Buffers: shared hit=2
  InitPlan 2
    ->  Result  (cost=0.00..0.26 rows=1 width=1) (actual time=0.423..0.427 rows=1 loops=1)
          Buffers: shared hit=29
  ->  Append  (cost=4.06..18677.57 rows=93406 width=47) (actual time=0.617..0.621 rows=0 loops=1)
        Buffers: shared hit=31
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.610..0.610 rows=0 loops=1)
              One-Time Filter: ((InitPlan 1).col1 AND (InitPlan 2).col1)
              Buffers: shared hit=31
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
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.000..0.000 rows=0 loops=1)
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
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.000..0.000 rows=0 loops=1)
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
        ->  Result  (cost=0.29..16988.67 rows=88466 width=45) (actual time=0.000..0.000 rows=0 loops=1)
              One-Time Filter: ((InitPlan 1).col1 AND (InitPlan 2).col1)
              ->  Index Scan using audit_log_2026m09_occurred_at_idx on audit_log_2026m09 audit_log_2  (cost=0.29..16988.67 rows=88466 width=45) (never executed)
        ->  Result  (cost=0.14..47.00 rows=190 width=80) (actual time=0.000..0.000 rows=0 loops=1)
              One-Time Filter: ((InitPlan 1).col1 AND (InitPlan 2).col1)
              ->  Index Scan using audit_log_2026m08_occurred_at_idx on audit_log_2026m08 audit_log_1  (cost=0.14..47.00 rows=190 width=80) (never executed)
Planning:
  Buffers: shared hit=3744
Planning Time: 4.512 ms
Execution Time: 0.717 ms
```
