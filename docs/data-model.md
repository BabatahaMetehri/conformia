# Data model

96 tables, **all** with RLS enabled. This document gives the structure and, above
all, the reasons — the exact shape of the columns lives in `supabase/migrations/`.

## The two objects that carry everything

### Obligation (`obligation_types`)

Described **once**. It carries its rules, not its instances: periodicity, due-date
calculation method (`due_rule`, as `jsonb`), required documents, responsible
entity, legal basis, criticality, number of validation levels.

⚠️ **`due_rule` is data, not code.** Adding an obligation requires no deployment. A
rule that cannot be expressed with the model extends the model, never the code
(CLAUDE.md §3.5).

### Occurrence (`obligation_occurrences`)

A dated instance, **generated automatically**. This is the daily working object.
Never entered by hand in the normal flow.

Uniqueness: `(entity_id, obligation_type_id, period_key)` — that is what makes
generation replayable without producing duplicates.

⚠️ **No amount column, by settled decision.** The platform tracks the PROCESS, not
the figures. Adding an amount would make it an accounting tool, with the
correctness and reconciliation obligations that come with one.

Two deadlines, always:

- `legal_due_date` — the authority's;
- `internal_due_date` — the team's, earlier by a few **working days** according to
  criticality (7 / 5 / 3 / 0). Alerts are based on the **internal** deadline:
  alerting on the legal date is alerting too late.

## Life cycle

```
TODO → IN_PROGRESS → PENDING_VALIDATION → VALIDATED → SUBMITTED → ARCHIVED
                            │
                            ├─→ REJECTED ──→ IN_PROGRESS
                            └─→ NOT_APPLICABLE
```

⚠️ **The transitions are DATA**, in `status_transition_rules` — not a `switch`.
Every transition goes through `evaluate_transition()` then
`apply_occurrence_transition()`, which check, in this order:

1. the transition is permitted from the current state;
2. the actor holds the permission;
3. the mandatory documents are present (`occurrence_missing_items()`);
4. the preparer is not the validator;
5. the authority reference and proof of filing exist, if the obligation requires
   them;
6. a lateness reason is supplied beyond the legal deadline.

`apply_occurrence_transition()` returns `APPLIED` when it has acted — not
`ALLOWED`, which is the verdict of `evaluate_transition()`. The two words mean two
different things.

**Optimistic locking**: the `version` column increments on every transition. Two
concurrent validations cannot both succeed.

## Documents

`documents` carries the `sha256` fingerprint, the version, the `supersedes_id`
link to the previous version, and `checklist_item_id` to the checklist line it
satisfies.

⚠️ **Attachment is what makes completeness.** A mandatory document is supplied when
a LIVE document is attached to it — no checkbox enters that calculation, and
`is_checked` is now merely derived from the upload.

⚠️ **`authenticated` has NO direct write right on `documents`.** Every upload goes
through `confirm_document_upload()`, `security definer`, which verifies the
ticket, the fingerprint and the occurrence. It is a guarantee of the model: you
can confirm it by trying.

`document_access_log` (partitioned by month) records every consultation. The trace
precedes issuing the signed URL, in the same transaction.

## Audit

`audit_log`, partitioned by month, **append-only guaranteed by trigger** — no
`UPDATE`, no `DELETE`.

Each row carries: actor, email, action, table, id, state before, state after,
changed fields, UTC timestamp, IP address, and since 0016 the request's
**correlation id**.

Sensitive columns are redacted on write (`audit_redacted_columns`): passwords,
tokens, secrets.

⚠️ **The trigger catches no exception.** If the log cannot be written, the business
transaction is rolled back. A compliance system that loses its traceability
silently is worth less than no system at all.

## Identities and permissions

```
profiles ──< user_roles >── roles ──< role_permissions >── permissions
                 │
                 └── domains   (NULL = all domains)
```

Since 0029, `profiles` also carries `phone` and `job_title`, copied from the
invitation when the account is created. ⚠️ The job title grants nothing — it is
informational; permissions come from the role.

`validation_delegations` lets a validator temporarily delegate their rights — with
start and end dates, revocation, and a trace in the audit
(`audit_log.on_behalf_of_id`). It exists to replace the real practice it makes
unnecessary: lending a password while on leave.

## Operations

| Table                  | Role                                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `job_runs`             | one row per scheduled run, including those with no effect                                                                           |
| `backup_runs`          | backup log, with fingerprint and destination                                                                                        |
| `restore_tests`        | verdict of the monthly restore drills                                                                                               |
| `export_runs`          | export traceability — who extracted what, when                                                                                      |
| `notifications`        | send queue AND the user's notification centre                                                                                       |
| `rate_limit_hits`      | sliding window for rate limiting, purged continuously                                                                               |
| `auth_attempts`        | sign-in attempts, for throttling by email and by IP                                                                                 |
| `holidays`             | Algerian public holidays — **data**, never a hard-coded table                                                                       |
| `cron_dispatch_config` | scheduled-job addresses and shared secret. ⚠️ No policy, no grant: unreachable through PostgREST, read only by `dispatch_cron_post` |

⚠️ `job_runs` also records runs **with no effect**: silence is indistinguishable
from a failure. The `job_health` view goes further — it starts from the list of
EXPECTED jobs, so a stopped scheduler returns `NEVER_RAN` or `STALE` instead of
returning nothing at all.

## Retention

Since 0028, `documents` carries `archived_offline_at` and `archived_in_backup_id`.
Beyond the window set by `retention_live_years` (3 by default), the **files** leave
storage and the **records stay**: fingerprint, size, uploader, access history.

⚠️ That is what lets you say "this document existed, here is its signature, it is
in the archive of such a date". Deleting the record would make the evidence
disappear along with the object. `exercise_inventory` shows, per year, how many
bytes are still online — the only measure that says what archiving would actually
free.

## Dates: the rule that admits no exception

- **Storage**: `timestamptz`, always in UTC.
- **Conversion**: at the boundary only — display, due-date calculation, period
  bounds — and always to `Africa/Algiers` (UTC+1, **no** daylight saving).
- **The Algerian weekend is Friday and Saturday.** Not Saturday–Sunday. All
  working-day logic depends on it.
- "By the 20th of the month" means **end of day in Algiers**, not in UTC.

## Conventions

- Physical deletion **forbidden** on business data: `deleted_at`, filtered at the
  RLS level.
- `SELECT *` forbidden in application code: explicit columns, always.
- `src/types/database.types.ts` is **generated** (`npm run db:types`) and never
  edited by hand. Any schema change is followed by regenerating it **in the same
  commit**.
- An applied migration is **immutable**. You write a new one.
