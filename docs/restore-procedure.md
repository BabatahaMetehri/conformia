# Restore procedure

> A backup that has never been restored is not a backup: it is a file you hope is
> readable.

This procedure is written to be followed by **someone who did not write the
application**. If a step assumes knowledge not written here, that is a defect in
this document — report it.

> The scripts print their messages in French. Expected output is quoted verbatim
> below so you can match it; the explanation around it is in English.

**Estimated total: 35 to 50 minutes** for a database of a few gigabytes. Record
the real duration at the end of this document.

---

## Before you start

| You need                                  | Where to find it                                  |
| ----------------------------------------- | ------------------------------------------------- |
| The `.tar.enc` archive                    | Pull-back media (`BACKUP_DESTINATION` or the NAS) |
| `BACKUP_ENCRYPTION_KEY`                   | **The company safe.** It is not with the archive. |
| An empty and **disposable** PostgreSQL db | See step 2                                        |
| `psql`, `pg_dump`, `tar`, Node 22+        | Workstation or operations server                  |

⚠️ **Never restore onto the production database.** The script refuses a target
whose name does not contain `restore`, `test` or `staging`, and only accepts a
local address by exception. That refusal is deliberate: it costs a minute, its
absence would cost the company.

---

## Step 1 — Check the archive is readable _(2 min)_

**Before anything else.** This step writes nowhere.

```bash
npm run restore -- --archive=/srv/backups/conformia-20260902T030000.tar.enc --verify-only
```

**Checkpoint** — the output must show:

```
ARCHIVE LISIBLE — déchiffrée, extraite, export présent.
Aucune écriture effectuée (--verify-only).
```

("Archive readable — decrypted, extracted, dump present. No write performed.")

**If decryption fails**: either the key is not the one used to encrypt, or the
archive is corrupt. The message says which. Compare the printed fingerprint with
the `sha256` of the matching row:

```sql
select started_at, sha256, destination from public.backup_runs
where status = 'SUCCEEDED' order by started_at desc limit 5;
```

Different fingerprints → the archive was altered after transfer. Take the
previous day's backup and report the incident.

---

## Step 2 — Prepare a disposable database _(3 min)_

```bash
createdb conformia_restore
# or, in SQL:
# CREATE DATABASE conformia_restore;
```

**Checkpoint**: `psql "postgresql://…/conformia_restore" -c '\dt'` answers without
error and lists no tables.

---

## Step 3 — Restore _(15 to 30 min depending on size)_

```bash
npm run restore -- \
  --archive=/srv/backups/conformia-20260902T030000.tar.enc \
  --target=postgresql://postgres:…@127.0.0.1:5432/conformia_restore \
  --storage=/srv/restore/storage
```

The script chains: fingerprint → decryption → extraction → `psql
--single-transaction` → checks.

⚠️ `--single-transaction`: the restore either succeeds **entirely** or leaves
**nothing**. A half-restored database is the worst possible outcome — it looks
like it works.

**Checkpoint** — the output ends with a table of counts:

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

**Any table at 0 fails the script** with exit code 1. A restored database with an
empty business table is not a successful restore.

---

## Step 4 — Compare against production _(5 min)_

The counts must be **consistent with production as of the backup date**, not
identical to today.

```sql
-- On the restored database AND on production
select 'obligation_occurrences' as t, count(*) from public.obligation_occurrences
union all select 'documents', count(*) from public.documents
union all select 'audit_log', count(*) from public.audit_log;
```

**Checkpoint**: the difference is explained by activity since the backup. A gap of
several thousand rows over one night is not explained — stop and investigate.

---

## Step 5 — Check real documents _(5 min)_

The database can be perfect and the documents absent. That is the most common
scenario, and the most expensive.

```bash
# How many files were restored?
find /srv/restore/storage -type f | wc -l
```

Compare with:

```sql
select count(*) from public.documents where deleted_at is null;
```

Then check **the integrity of three random documents**: the storage path is in
`documents.storage_path`, the expected fingerprint in `documents.sha256`.

```bash
sha256sum /srv/restore/storage/<storage_path>
```

**Checkpoint**: all three fingerprints match. If one differs, the document was
altered **before** the backup — that is a document integrity incident, not a
restore problem; the monthly integrity check should have flagged it.

---

## Step 6 — Record it _(2 min)_

```sql
select public.start_restore_test(<id of the backup_runs row>);
-- then, once the checks are done:
select public.finish_restore_test(
  <the id returned above>, 'PASSED',
  '{"obligation_occurrences": 846, "documents": 391}'::jsonb,
  3, 3, '[]'::jsonb, 412,
  'Restauration d''épreuve manuelle, conforme.');
```

The monthly job does this by itself (see below); in a manual restore it is on
you. A successful restore that is not recorded proves nothing on the day someone
asks for the date of the last drill.

---

## Step 7 — Destroy the test database _(1 min)_

```bash
dropdb conformia_restore
rm -rf /srv/restore/storage .restore-work
```

⚠️ It contains **all** the company's data, without production's protections.
Leaving it lying around cancels the benefit of everything else.

---

## Real restore after a disaster

Same procedure, with three differences:

1. **Step 1 is mandatory and on several archives**: verify the most recent one
   _and_ the previous day's before choosing.
2. The target is the new production database. The name guard will refuse it: go
   through a `…_restore` database, check, **then** rename. Do not modify the
   guard.
3. After restoring, regenerate the types (`npm run db:types`) and apply any
   migrations created after the backup (`npm run db:migrate`).

**Storage is restored before reopening the application.** Users on a database
with no documents will upload duplicates.

---

## Monthly drill

`npm run restore:test` restores the latest backup into a disposable database,
counts the main tables, checks the integrity of a sample of documents, and writes
its verdict to `restore_tests`.

⚠️ **It is not scheduled by the database.** It was listed as a `pg_cron` job and
never worked — migration 0025 removed it. Like the backup itself, it is a script
needing a disk and `pg_dump`, which the hosted application does not have. Schedule
it through the **operating system**, on the 1st of each month; see
`docs/complete-guide.md`, part 8.

```sql
select started_at, status, duration_seconds, documents_verified, documents_sampled, failures
from public.restore_tests order by started_at desc limit 12;
```

An empty `failures` column (`[]`) and a `PASSED` status: the latest backup is
restorable, as of that date. That is the only claim this project is willing to
make about its backups.

---

## Real durations observed

| Date                              | Database size | Storage size | Duration | By  |
| --------------------------------- | ------------- | ------------ | -------- | --- |
| _(to fill in at the first drill)_ |               |              |          |     |
