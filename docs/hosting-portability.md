# Hosting portability

> Whether the data must legally reside in Algeria is not settled. The
> architecture has to make the answer **painless**, whichever way it goes.

This document exists so that a legal decision does not turn into a rewrite
project. It lists what the application actually depends on, and what has to change
to move it.

---

## What the application depends on

**Two things, and nothing else:**

| Dependency                     | Interface used                           | Substitutable provider                      |
| ------------------------------ | ---------------------------------------- | ------------------------------------------- |
| **PostgreSQL 15+**             | standard SQL, RLS, `pg_cron`, `pgcrypto` | Yes — Supabase, RDS, Cloud SQL, bare server |
| **S3-compatible object store** | Storage API of `@supabase/supabase-js`   | Yes — MinIO, Ceph, Wasabi, S3               |

Everything else — Next.js, rendering, scheduled jobs — runs on an ordinary Node
server.

### What is _not_ a dependency

- **No host Edge function.** Scheduled jobs go through `pg_cron` + `pg_net`, or
  through plain authenticated HTTP routes (`/api/cron/*`) that a system `cron` can
  call. Both paths exist and are exercised.
- **No proprietary authentication service other than GoTrue**, which is open
  source and self-hostable.
- **No PostgreSQL extension exclusive to one host.** `pg_cron`, `pgcrypto` and
  `pg_net` are available everywhere; their absence is _degrading_, not blocking
  (the migrations say so explicitly and offer the fallback).

---

## Switching to a self-hosted instance

### 1. Environment variables to change

**These are the only ones.** No line of application code changes.

```diff
- NEXT_PUBLIC_SUPABASE_URL="https://xxxx.supabase.co"
+ NEXT_PUBLIC_SUPABASE_URL="https://conformia.agroespace.dz"

- NEXT_PUBLIC_SUPABASE_ANON_KEY="…hosted project key…"
+ NEXT_PUBLIC_SUPABASE_ANON_KEY="…local instance key…"

- SUPABASE_SERVICE_ROLE_KEY="…hosted project key…"
+ SUPABASE_SERVICE_ROLE_KEY="…local instance key…"

- DATABASE_URL="postgresql://…@db.xxxx.supabase.co:5432/postgres"
+ DATABASE_URL="postgresql://…@10.0.0.12:5432/conformia"

  NEXT_PUBLIC_APP_URL="https://conformia.agroespace.dz"
```

The backup, email and cron variables are host-independent and do not move.

### 2. Settings in the database, not in code

⚠️ **This section used to be wrong, and the way it was wrong matters.** It said
the scheduled-job addresses were set with:

```sql
alter database conformia set "app.generate_occurrences_url" = '…';   -- ✗ never worked
```

A custom parameter can only be stored durably with SUPERUSER, which Supabase does
not grant — not on the hosted offering, and not on the local stack either. The
setting would have stayed NULL forever, and the job would have posted to an empty
address. It also listed `app.backup_url` and `app.restore_test_url`, which pointed
at routes that do not exist.

Since migration 0025 the configuration lives in a table, written by a script:

```bash
DATABASE_URL="postgresql://…" \
NEXT_PUBLIC_APP_URL="https://conformia.agroespace.dz" \
CRON_SECRET="<the same one as the application>" \
npm run cron:config
```

Two jobs, not five: `generate_occurrences_url` and `notifications_url`. The weekly
digest is already produced by the notification cycle; the backup and the restore
drill are **scripts**, not routes, and are scheduled by the operating system.

The email provider changes **without redeployment**, by one write:

```sql
update public.app_settings set value = to_jsonb('smtp'::text) where key = 'email_provider';
```

⚠️ Not `set email_provider = 'smtp'`. That column existed alongside the key/value
row, the screen wrote the row and the code read the column, and the switch had no
effect. Migration 0026 removed the column.

### 3. Data migration

```bash
# 1. Export from the current instance
npm run backup -- --kind=MANUAL

# 2. Restore onto the new one
npm run restore -- --archive=… --target=postgresql://…/conformia_restore --storage=/srv/storage

# 3. Checks (docs/restore-procedure.md, steps 4 and 5), then switch DNS
```

### 4. What to plan for on the infrastructure side

| Component      | Self-hosted                                     |
| -------------- | ----------------------------------------------- |
| PostgreSQL     | 15+, extensions `pgcrypto`, `pg_cron`, `pg_net` |
| Object storage | MinIO or S3-equivalent, **private** bucket      |
| GoTrue         | Official `supabase/gotrue` container            |
| PostgREST      | Official `postgrest/postgrest` container        |
| Storage API    | Official `supabase/storage-api` container       |
| Application    | Node 22+, `npm run build && npm run start`      |
| TLS            | Terminated at the reverse proxy                 |

The whole thing fits in Supabase's reference `docker-compose`, on a single
machine. Sizing is modest: AGROESPACE's annual volume is counted in hundreds of
dossiers, not millions.

---

## What does not travel as-is

Honesty about the friction points. None is blocking; all take half a day.

1. **PITR (backup level 1)** is a host service. Self-hosted, it has to be rebuilt
   with `wal-g` or `pgBackRest`. Level 2 backup works identically — which is
   precisely why it exists.

2. **The JWT tokens change secret.** Every session is invalidated at the switch:
   users sign in again. To be announced, not discovered.

3. **Calendar feed links (ICS) contain the domain.** After the switch each
   subscriber has to resubscribe — the old link points at a host that no longer
   answers. The `/profile/calendar` screen already carries the instruction.

4. **`pg_net` is not installed everywhere.** Without it the migrations fall back
   to a `raise notice`, and the jobs must be called by a system `cron` on the
   `/api/cron/*` routes, with `CRON_SECRET`. ⚠️ On a fresh Supabase project pg_net
   is **available but not created** — migration 0025 now creates it explicitly,
   after a stack where its absence made every scheduled job fail on "schema net
   does not exist", visible only in `cron.job_run_details`.

---

## Verify portability, rather than asserting it

The application already runs on **two different hostings** in its development
cycle:

- the local Supabase stack (`supabase start`), which is self-hosting in miniature
  — same containers, same versions;
- each developer's environment.

The whole integration suite and the end-to-end tests run against the **local**
stack. In other words: self-hosted mode is not a documented hypothesis, it is the
mode the project is tested in every day.

---

## Decision for management

The switch is a one-day operation, half of which is verification. What has to be
settled is not technical:

- [ ] Must the data reside on Algerian territory?
- [ ] If so, on AGROESPACE infrastructure or with a local host?
- [ ] Who operates PostgreSQL day to day — updates, monitoring, level-1 backups?

The third question is the real one. Managed hosting buys operations, not
technology.
