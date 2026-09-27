# Backup strategy

> The classic failure is not the backup that fails: that one is visible. It is
> the one that fails **silently** for eight months, and is discovered the day you
> have to restore. This whole document is organised around that sentence.

## What there is to lose

| Data                                  | Where it lives                                 | Rebuildable?                                   |
| ------------------------------------- | ---------------------------------------------- | ---------------------------------------------- |
| Obligations referential               | PostgreSQL                                     | Yes, but at the cost of an accountant's ruling |
| Occurrences, transitions, assignments | PostgreSQL                                     | **No**                                         |
| Audit log                             | PostgreSQL, partitioned, append-only           | **No** — and it is what an inspector reads     |
| Uploaded documents                    | Object storage (`compliance-documents` bucket) | **No**                                         |
| Accounts and permissions              | `auth.users` + `public.profiles`               | Partially                                      |

⚠️ **The database alone is not enough.** A restore without storage gives you an
application where every dossier exists and every document is gone: the screens
work, the download links fail one by one. That is why `scripts/backup.ts`
**refuses to run** without `BACKUP_STORAGE_SOURCE`, unless `BACKUP_ALLOW_DB_ONLY=true`
is set knowingly.

---

## The three levels

### Level 1 — Managed continuous backup

The host's point-in-time recovery, **7-day retention**.

- Covers recent human error: an unfortunate `DELETE`, a failed migration.
- Second-level granularity, restored by the host.
- **Does not cover** losing the hosting account, nor a legal decision about where
  data must live. Hence level 2.

Enable it in the Supabase console: _Database → Backups → Point in Time Recovery_.
On a self-hosted instance the equivalent is `wal-g` / `pgBackRest` configured on
the PostgreSQL server.

### Level 2 — Daily logical export, pulled back and encrypted

`scripts/backup.ts`, **03:00 Algiers time**.

1. `pg_dump --clean --if-exists --format=plain`, gzipped.
2. Copy of the document storage (rclone, or a mounted path).
3. Assembled into a `.tar`, then **AES-256-GCM encrypted**.
4. Transferred to media **controlled by AGROESPACE** — a local directory on the
   company server, or an rclone remote (NAS).
5. **Read back at the destination**: size and SHA-256 re-checked.
6. Recorded in `backup_runs` **and** `job_runs`.

⚠️ Step 5 is the one people skip and must not. A `cp` returning 0 says the write
was **accepted**, not that the bytes are **readable**: disk full at the end of the
copy, a network mount dropping, a quota reached. Without the read-back,
`verified_at` stays null — and a `SUCCEEDED` row with no `verified_at` should be
read as a doubt, not a success.

### Level 3 — Monthly archive, kept 24 months

The backup taken on the 1st of the month is copied to slow-rotation storage.
Twenty-four months: how long a tax inspection can ask about a closed financial
year.

---

## Rotation

| Cadence | Kept      | Covers                         |
| ------- | --------- | ------------------------------ |
| Daily   | 7         | this week's incident           |
| Weekly  | 4         | the error found a month later  |
| Monthly | 12        | the current financial year     |
| Archive | 24 months | an inspection on a closed year |

Rotation is **not** done by the script: it is delegated to whatever owns the
space (NAS lifecycle policy, `rclone` with `--max-age`, or `logrotate`). A backup
script that deletes backups is a script that can delete the wrong one.

---

## Encryption

- **AES-256-GCM**, key derived with `scrypt` from a random per-archive salt.
- Format: `[salt 16][iv 12][ciphertext …][auth tag 16]`.
- GCM and not CBC: it **authenticates** as well as encrypts. An archive altered
  by one byte fails decryption instead of returning wrong data.

⚠️ **The key never travels with the archive.** `BACKUP_ENCRYPTION_KEY` lives in
the environment of the server that backs up, and **in the company safe**. An
encrypted archive stored next to its key is a plaintext archive.

⚠️ **Losing the key means losing the archives.** There is no recovery. Recording
it offline is part of commissioning, not part of "good practices to get to one
day".

---

## The alert — the real subject

A notification goes to **every ADMIN and to DIRECTION**, both in-app _and_ by
email, as soon as **no backup has succeeded for 36 hours**.

- Carried by `notify_admins_of_stale_backup()`, called on **every hourly
  notification cycle** — not by a dedicated job. A backup alert carried by its own
  scheduler would depend on a mechanism whose health nobody watches, and would go
  quiet exactly when it should speak.
- **A total absence of backups triggers the alert just as much** as a stale one.
  A fresh installation therefore alerts from the first hour, and that is intended:
  an empty table treated as "all is well" is the purest form of decorative
  safeguard.
- One alert per person per channel every 24 h. Repeated hourly, it would stop
  being read after two days.
- 36 h and not 24: an isolated failure that was caught up wakes nobody; two
  consecutive failures do.

The dashboard banner exists too, but it is not enough — you have to open an
admin screen to see it.

---

## Configuration

```bash
# Required
BACKUP_ENCRYPTION_KEY="…"          # 32 characters minimum, kept outside the app
BACKUP_DESTINATION="/srv/backups"  # OR BACKUP_RCLONE_REMOTE
BACKUP_STORAGE_SOURCE="…"          # mounted path, or rclone remote of the bucket

# Optional
BACKUP_RCLONE_REMOTE="nas:conformia"
BACKUP_WORK_DIR="/var/tmp/conformia-backup"
BACKUP_ALLOW_DB_ONLY="false"       # ⚠️ development only
```

```bash
npm run backup                     # daily
npm run backup -- --kind=MONTHLY   # monthly archive
```

Prerequisites on the backup machine: `pg_dump`, `tar`, and `rclone` if a remote
is used. The script names the missing tool precisely.

---

## ⚠️ The backup is NOT scheduled by the database

It used to be listed as a `pg_cron` job. It never worked, and migration 0025
removed it: a backup writes to a disk that the hosted application cannot reach,
and it needs `pg_dump`, which a Route Handler does not have. Leaving the job in
the list was worse than not having it — it made the backup look automated when it
was not.

It is scheduled by the **operating system** of a machine you control. See
`docs/complete-guide.md`, part 8, for the Windows Task Scheduler and `crontab`
entries.

---

## Checking it works

```sql
-- The last ten runs
select started_at, kind, status, verified_at,
       pg_size_pretty(size_bytes) as size, destination
from public.backup_runs order by started_at desc limit 10;
```

A healthy row has `status = 'SUCCEEDED'` **and** a non-null `verified_at`.

To exercise the alert without waiting 36 hours:

```sql
update public.backup_runs set finished_at = now() - interval '40 hours'
where id = (select max(id) from public.backup_runs where status = 'SUCCEEDED');
select public.notify_admins_of_stale_backup(36);
```

The integration test `tests/integration/exports-backups.test.ts` covers this
scenario, the total absence of backups, and the absence of hourly repetition.

---

## What is left to do at commissioning

- [ ] Enable PITR at the host (level 1).
- [ ] Choose and mount the pull-back media (level 2).
- [ ] Generate `BACKUP_ENCRYPTION_KEY` and put it in the safe.
- [ ] Schedule `npm run backup` at 03:00 Algiers **through the OS scheduler** —
      the database does not do it, see above.
- [ ] Configure rotation on the media.
- [ ] **Run a restore drill** (see `restore-procedure.md`) and record its real
      duration.
