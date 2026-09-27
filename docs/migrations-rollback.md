# Migration rollback

⚠️ **A migration with no documented rollback is an irreversible decision taken
without saying so.** This file exists so that "can we go back?" has an answer
**before** the incident, not during it.

**Upkeep rule:** every new migration adds its row here, **in the same commit**. A
missing row is noticed in review; a row written three weeks later is written from
memory.

---

## The three kinds of rollback

Not all migrations undo the same way, and confusing the three is the best way to
lose data while believing you are saving it.

| Kind                         | What it means                                                                | How you go back                                                      |
| ---------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Reversible**               | Objects added, nothing destroyed.                                            | Drop them. No data lost.                                             |
| **Reversible with loss**     | A column, table or row was dropped or rewritten.                             | Restore from backup. The loss is **whatever was written since**.     |
| **Irreversible in practice** | The rollback would break deployed code, or the original information is gone. | You do not go back: you fix **forward**, with a follow-up migration. |

⚠️ **"Irreversible" does not mean "dangerous".** It means the fallback plan is a
fix, not a rollback — and that it therefore has to have been rehearsed in
staging.

---

## Before any rollback — no exceptions

```bash
npm run backup      # even if "it will only take a minute"
```

A rollback is a write. An unbacked-up write is a bet.

---

## The table

| #    | Migration                        | Kind             | Rollback                                                                                                                                                                                                                                                                                        |
| ---- | -------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0001 | `core_schema`                    | **Irreversible** | The foundation: entities, domains, obligations, occurrences. Undoing it means emptying the database. No rollback — full restore.                                                                                                                                                                |
| 0002 | `identity_rls`                   | **Irreversible** | Roles, permissions, RLS. Removing them would open every table. Fix forward, never back.                                                                                                                                                                                                         |
| 0003 | `audit_documents`                | **Irreversible** | `audit_log` is append-only and partitioned. Undoing it would destroy traceability — that is, the product's reason to exist.                                                                                                                                                                     |
| 0004 | `auth_hardening`                 | Reversible       | `drop` the hardening triggers and `auth_attempts`. ⚠️ Reopens the door to password stuffing: staging only.                                                                                                                                                                                      |
| 0005 | `navigation_search`              | Reversible       | `drop function global_search`, drop the search indexes. No business data touched.                                                                                                                                                                                                               |
| 0006 | `obligations_module`             | **With loss**    | Referential columns. Dropping them loses the due-date rules that were entered. Restore.                                                                                                                                                                                                         |
| 0007 | `occurrence_workspace`           | Reversible       | `drop` the workspace views and statistics. Recomputable.                                                                                                                                                                                                                                        |
| 0008 | `occurrence_detail`              | **With loss**    | Comments and checklists. Dropping them loses users' work.                                                                                                                                                                                                                                       |
| 0009 | `documents_module`               | **Irreversible** | Storage holds real documents; the database holds their fingerprints. Undoing it would separate the two.                                                                                                                                                                                         |
| 0010 | `workflow`                       | **Irreversible** | State machine and archive immutability. Without it an archived dossier becomes editable again — the product's strongest guarantee.                                                                                                                                                              |
| 0011 | `dashboard_admin`                | Reversible       | `drop` the dashboard views and the deactivation guard.                                                                                                                                                                                                                                          |
| 0012 | `validation_queue_scale`         | Reversible       | `drop` the queue indexes. ⚠️ The only effect is a slow queue: that is performance, not data.                                                                                                                                                                                                    |
| 0013 | `generation_engine`              | Reversible       | `drop` the generation functions. Occurrences already created remain.                                                                                                                                                                                                                            |
| 0014 | `notifications`                  | **With loss**    | Rules, escalations, send queue. Losing `notifications` loses the alert history — and deduplication with it: alerts already sent would go out again.                                                                                                                                             |
| 0015 | `exports_backups`                | Reversible       | `drop` `export_runs` and `backup_runs`. ⚠️ Loses the history proving **when** you backed up — at the precise moment you would need it.                                                                                                                                                          |
| 0016 | `observability`                  | Reversible       | `drop` `job_runs` and the locks. ⚠️ Blinds monitoring: only alongside an application rollback.                                                                                                                                                                                                  |
| 0017 | `rate_limit`                     | Reversible       | `drop` the counters. Reopens unlimited writes.                                                                                                                                                                                                                                                  |
| 0018 | `assignment_registers`           | **With loss**    | Commercial registers and the assignment triad. Entered registers are real company data.                                                                                                                                                                                                         |
| 0019 | `authorization_model`            | **Irreversible** | Role matrix rebuilt, 92 policies rewritten, `domain_id` denormalised. Going back would restore policies the code no longer knows about.                                                                                                                                                         |
| 0020 | `registers_assignments`          | Reversible       | `drop` the assignment views and functions; the columns stay.                                                                                                                                                                                                                                    |
| 0021 | `assignment_ui`                  | Reversible       | `drop function reassign_occurrence_triad`, return `documents_search` to its 0020 form. ⚠️ The `REGISTERS` value added to `export_kind` **cannot be removed**: PostgreSQL does not drop enum values. It stays, unused. ⚠️ Its appendix also adds the triad enum values — see 0022.               |
| 0022 | `notification_triad`             | **With loss**    | Audiences and escalation chain. The enum values added (`RESPONSIBLE`, `DEPUTY`, `SUPERVISOR`, `WHATSAPP`) **cannot be removed**. The rollback is to redefine `notification_audience_members` and the rules, not to undo the enum.                                                               |
| 0023 | `notification_recipient_filters` | Reversible       | Redefine `due_notification_candidates` in its 0022 form. ⚠️ **Do not**: this version is what restores channel preference, the deactivated-account check, the exclusion of profiles with no address, and the revocation of `authenticated` access. Going back reintroduces all four.             |
| 0024 | `holiday_calendar_coverage`      | Reversible       | `drop view holiday_calendar_coverage`, and redefine `dashboard_alerts` without the `HOLIDAYS_INCOMPLETE` branch. ⚠️ **Do not**: that branch is the only thing that reports an empty holiday calendar, whose absence is silent by nature.                                                        |
| 0025 | `cron_dispatch_auth`             | **Irreversible** | Undoing it returns to scheduled jobs that cannot authenticate, cannot store their address, and have no `pg_net`. That is not a rollback, it is the original outage. Fix forward. ⚠️ `drop table cron_dispatch_config` also loses the shared secret — re-run `npm run cron:config`.              |
| 0026 | `settings_single_source`         | **With loss**    | Re-adding the four columns to `app_settings` would restore the divergence they caused: the screen wrote the row, the code read the column. The values live in the rows; re-adding the columns would create empty duplicates.                                                                    |
| 0027 | `security_hardening`             | Reversible       | Re-grant `truncate, references, trigger` to `anon, authenticated`, and `execute` on `health_snapshot`. ⚠️ **Do not**: that re-opens a public health probe and grants a privilege RLS does not filter.                                                                                           |
| 0028 | `exercise_retention`             | Reversible       | `drop view exercise_inventory`, `drop function mark_exercise_archived`, drop the two `documents` columns. ⚠️ Dropping `archived_in_backup_id` loses the link saying **which archive** holds a file taken offline — the fiches remain, but finding the file means restoring archives one by one. |
| 0029 | `profile_contact_fields`         | Reversible       | Return `handle_new_auth_user` to its 0001 form and drop the two `user_invitations` columns. Phone numbers and job titles already copied onto profiles remain.                                                                                                                                   |

---

## What never undoes, whatever the migration

Three categories, worth knowing before promising a rollback:

1. **Enum values.** PostgreSQL has no `DROP VALUE`. An added value stays. The
   rollback is to stop using it, not to remove it.
2. **Audit partitions already written.** `audit_log` is append-only by trigger. A
   rollback claiming to erase them would fail — and that is intended.
3. **Storage objects.** An uploaded document exists outside the database. Undoing
   a migration does not take it back; restoring a database without restoring
   storage gives you a database referencing documents that are gone. That is why
   `scripts/backup.ts` **refuses** to run without `BACKUP_STORAGE_SOURCE`.

---

## Rehearse before you need it

A rollback written and never executed is a hypothesis. In staging, at least once:
apply the latest migration, undo it, check the application still starts. Whatever
breaks then would have broken in production, on a bad day, with someone waiting.
