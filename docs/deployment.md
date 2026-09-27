# Deployment — from your workstation to the team

This document takes CONFORMIA from the development machine to an installation the
team opens in a browser. It assumes no hosting decision has been made yet.

`docs/go-live.md` says **what must be settled** before opening to the team
(secrets, real data, backups, pilot). This file says **how you install**. Read
both, in that order.

`docs/complete-guide.md` is the simpler, shorter version of the same path — start
there if you only want the steps.

> The app is in French; screen names below are given as they appear.

---

## What is deployed — two pieces, not one

| Piece            | What it is                                 | Where it goes               |
| ---------------- | ------------------------------------------ | --------------------------- |
| **The database** | Postgres, authentication, document storage | A hosted Supabase project   |
| **The app**      | The Next.js site the team opens            | Vercel, or a server you run |

⚠️ **Docker is for development only.** `supabase start` builds a local,
disposable copy on your machine. Only you can reach it, and it disappears when
the computer shuts down. Nothing below uses it.

### The hosting choice, in one sentence

**Hosted Supabase + Vercel.** It is the combination the application is written
for, the one where migrations and scheduled jobs work without adaptation, and the
one that asks nobody to administer a Linux server.

A self-managed server remains possible — the **VPS variant** section gives the
steps. It is justified if the data must stay on a machine in Algeria. It then
costs what a server costs: somebody to keep it up to date.

---

## Before you start

```bash
npm install -g supabase   # if the CLI is not already there
supabase --version        # 2.x expected
git status                # must be clean
npm test && npm run build # must pass before deploying anything
```

Also prepare:

- a **Supabase** account (supabase.com);
- a **Vercel** account (vercel.com), connected to the Git repository;
- a **Resend** account (resend.com) for sending email;
- the **domain name** the team will type, if you want one.

---

## Step 1 · The Supabase project

1. **Create the project.** supabase.com → _New project_.
   - **Name**: `conformia-production`.
   - **Region**: `eu-central-1` (Frankfurt) or `eu-west-3` (Paris) — the closest
     to Algeria. The region cannot be changed afterwards.
   - **Database password**: generated, long. ⚠️ It is shown **once only**. Put it
     in the company safe immediately; losing it costs a full reset.

2. **Collect the three values** under _Project Settings → API_:

   | Value           | Where it will be used           |
   | --------------- | ------------------------------- |
   | _Project URL_   | `NEXT_PUBLIC_SUPABASE_URL`      |
   | _anon / public_ | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
   | _service_role_  | `SUPABASE_SERVICE_ROLE_KEY`     |

   ⚠️ **The `service_role` key bypasses all security.** It never goes into a
   versioned file, nor a `NEXT_PUBLIC_*` variable, nor a message. If it leaks,
   regenerate it from that same screen — and everything using it must be
   redeployed.

3. **Collect the connection string** under _Project Settings → Database →
   Connection string → URI_. That is `DATABASE_URL`. Replace `[YOUR-PASSWORD]`
   with the password from step 1.

---

## Step 2 · Apply the schema

```bash
supabase login
supabase link --project-ref <project-ref>   # the ref is in the dashboard URL
supabase db push
```

`db push` applies the 29 migrations in order. Allow one to two minutes.

⚠️ **Never the dashboard's SQL editor.** A migration applied by hand does not
exist in the repository: production diverges from the code, and the divergence is
discovered at the next deployment, when it is too late to know what changed.

### The referential and the registers

```bash
DATABASE_URL="postgresql://…" npm run db:seed
```

This loads the 23 obligations and the 5 commercial registers. The seed is
idempotent: re-running it duplicates nothing.

⚠️ **Read `supabase/seed/0003_registres_agroespace.sql` first.** It carries three
points marked "to confirm" — a register number with an illegible digit, which of
the five is the principal one, and the missing expiry dates. A wrong register can
be fixed afterwards on the **Registres** screen, but it is better to start right.

### Check the extensions are there

```sql
select extname from pg_extension where extname in ('pg_cron', 'pg_net');
```

Both must appear. Migration 0025 creates them; if one is missing, enable it under
_Database → Extensions_ and re-run `supabase db push`.

⚠️ **Without `pg_net`, nothing is automated.** The jobs schedule perfectly well
and fail at every firing, in a log nobody opens.

---

## Step 3 · Email

**Without this step nobody can be invited**: the invitation is an email, and it
is the only way into the application.

1. Create a Resend account and **add AGROESPACE's domain** to it.
2. Add the DNS records Resend gives you (SPF, DKIM). Without them messages land
   in spam — which looks a great deal like "the invitation never arrived".
3. Create an API key: that is `RESEND_API_KEY`.
4. `SMTP_FROM` must be an address **on that domain**: `conformia@agroespace.dz`.

The provider is then chosen **in the database**, not in the code: screen
**Administration → Réglages**, field `email_provider`. An installation that
prefers AGROESPACE's internal SMTP switches there without a redeployment.

⚠️ That switch did not work before migration 0026: the same setting existed both
as a row and as a column, the screen wrote the row and the code read the column.
It saved, displayed back correctly, and changed nothing.

---

## Step 4 · The application on Vercel

1. vercel.com → _Add New → Project_ → import the repository.
2. The framework is detected on its own (Next.js). Change neither the build
   command nor the output directory.
3. **Fill in the environment variables** — this is the heart of the step. All are
   validated at start-up: a missing value fails the build by naming it, which is
   far preferable to a limping start.

| Variable                        | Value                                                 |
| ------------------------------- | ----------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | the project URL (step 1)                              |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the anon key (step 1)                                 |
| `NEXT_PUBLIC_APP_URL`           | `https://conformia.agroespace.dz` — **no trailing /** |
| `NODE_ENV`                      | `production`                                          |
| `SUPABASE_SERVICE_ROLE_KEY`     | the service_role key (step 1)                         |
| `DATABASE_URL`                  | the connection string (step 1)                        |
| `RESEND_API_KEY`                | the Resend key (step 3)                               |
| `SMTP_FROM`                     | `conformia@agroespace.dz`                             |
| `SMTP_HOST` `SMTP_PORT`         | Resend's, or your internal SMTP                       |
| `SMTP_USER` `SMTP_PASSWORD`     | same                                                  |
| `CRON_SECRET`                   | **generated**, see below                              |
| `BACKUP_ENCRYPTION_KEY`         | **generated**, see below                              |
| `LOG_LEVEL`                     | `info`                                                |

The two secrets are made, not invented:

```bash
npm run secrets
```

⚠️ **`BACKUP_ENCRYPTION_KEY` is the only one whose loss is irreversible.** It
encrypts the archives: without it, backups become a pile of unreadable bytes. It
goes in the company safe, outside the application, **the day you generate it**.

4. _Deploy_. Two to three minutes.

5. **The domain**: _Settings → Domains_ → add `conformia.agroespace.dz` and create
   the DNS record shown. The HTTPS certificate is automatic. Then put the final
   address into `NEXT_PUBLIC_APP_URL` and redeploy — the links in notification
   emails depend on it.

---

## Step 5 · Wiring the scheduled jobs

This is the step people forget, and forgetting it produces **no visible error**:
simply no dossiers created and no reminders sent.

```bash
DATABASE_URL="postgresql://…" \
NEXT_PUBLIC_APP_URL="https://conformia.agroespace.dz" \
CRON_SECRET="<the same one as in Vercel>" \
npm run cron:config
```

The script writes the public address and the secret into a table only the
database can read. ⚠️ **The `CRON_SECRET` must be exactly the one in Vercel.** If
they differ, every call comes back 401 — and a 401 raised by the database
surfaces nowhere.

### Verify — do not assume

```sql
-- 1. The two jobs are scheduled, and no others.
select jobname, schedule from cron.job where jobname like 'conformia-%';

-- 2. Trigger a call right now, without waiting for 2 a.m.
select public.dispatch_cron_post('generate_occurrences_url');

-- 3. Look at what the application answered (a few seconds later).
select status_code, accepted, left(response_excerpt, 120)
from public.cron_dispatch_log order by dispatched_at desc limit 5;
```

`status_code = 200` and `accepted = true`: it is wired. A **401** means the
secrets differ; a **404**, that the address is wrong; **no rows at all**, that
`pg_net` is emitting nothing.

Final check, on the application side — screen **Administration → Traitements**: a
`generate-occurrences` line must appear there, with status `SUCCEEDED`.

---

## Step 6 · Backups

⚠️ **They are NOT automated by the database**, and that is deliberate: a backup is
a script that writes an encrypted archive to a disk AGROESPACE controls. The
hosted application has access neither to that disk nor to `pg_dump`.

So you need a machine that runs — an office PC left on overnight is enough — and
an operating-system scheduled task:

**Windows** (Task Scheduler, daily at 02:00):

```
Program       : C:\Program Files\nodejs\node.exe
Arguments     : scripts\backup.ts
Start in      : C:\path\to\conformia
```

**Linux / macOS** (`crontab -e`):

```cron
0 2 * * *  cd /srv/conformia && npm run backup  >> /var/log/conformia-backup.log 2>&1
0 3 1 * *  cd /srv/conformia && npm run restore:test >> /var/log/conformia-restore.log 2>&1
```

The backup machine needs `DATABASE_URL`, `BACKUP_ENCRYPTION_KEY`,
`BACKUP_DESTINATION` and `BACKUP_STORAGE_SOURCE` in its environment.

⚠️ **A backup never restored is not a backup.** `npm run restore:test` exists for
that, and `docs/go-live.md` §D describes the full drill — cut the chain for forty
hours and check the alert fires. It is done **once, in full**, before opening to
the team.

Supabase additionally provides its own daily backups (_Database → Backups_). They
do not replace yours: they live at the same host as the data they protect.

---

## Step 7 · The first administrator

The application has no sign-up: you enter by invitation, and an invitation needs
an administrator. That knot is cut **once**, by hand.

1. _Authentication → Users → Add user_. Work email address, long temporary
   password, **Auto Confirm User** ticked.
2. Copy the new account's id.
3. In the SQL editor — the one exception to the rule, and it touches no schema:

```sql
insert into public.user_roles (user_id, role_id, domain_id)
select '<the-account-id>', r.id, null
from public.roles r where r.code = 'ADMIN';
```

4. Sign in at `https://conformia.agroespace.dz`. The application **forces second
   factor enrolment** before anything else: the `ADMIN` role requires it. Have the
   authenticator app (Google Authenticator, Authy) ready before you start.
5. Change the temporary password.

⚠️ `scripts/create-user.mjs` **cannot** be used here: it refuses any non-local
database, deliberately.

---

## Step 8 · The team's accounts

Everything else goes through the screen, never again through SQL. The detail is
in the user manual; here is the sequence.

**Administration → Comptes → Inviter**, once per person:

| Person               | Role          | Domain             | Second factor |
| -------------------- | ------------- | ------------------ | ------------- |
| The director         | `DIRECTION`   | All domains        | **Enforced**  |
| You                  | `ADMIN`       | —                  | **Enforced**  |
| You (second role)    | `RESPONSABLE` | as your work needs | —             |
| The accountant       | `RESPONSABLE` | `FISCAL`           | Recommended   |
| Their stand-in       | `SUPPLEANT`   | `FISCAL`           | Recommended   |
| HR lead              | `RESPONSABLE` | `SOCIAL`           | Recommended   |
| Department head      | `SUPERVISEUR` | their domain       | Recommended   |
| External accountants | `EXTERNAL`    | `FISCAL`           | —             |
| Statutory auditor    | `AUDITOR`     | All domains        | —             |

Three things that surprise people, better known in advance:

- ⚠️ **An `ADMIN` sees no dossiers.** No deadlines list, no documents, no
  validation queue: those entries do not appear for them. Technical
  administration and business content are separated. If you also need to handle
  dossiers, hold `ADMIN` **and** a business role — do not try to widen `ADMIN`.
- ⚠️ **You cannot give yourself a role.** The database refuses. You need a second
  administrator: that is what stops one person granting themselves everything.
- ⚠️ **`AUDITOR` expires at 90 days, `EXTERNAL` at 365.** The expiry field becomes
  mandatory for those two. Temporary access that does not expire is not
  temporary.

Every invitation sends a single-use link; the person chooses **their own**
password. No password travels by email.

---

## Step 9 · The checklist before opening

None of this is assumed — every line is checked.

- [ ] `supabase db push` done, 29 migrations applied
- [ ] `npm run db:seed` done — 23 obligations, 5 registers
- [ ] `pg_cron` **and** `pg_net` present
- [ ] `npm run cron:config` done, with Vercel's `CRON_SECRET`
- [ ] A manually triggered call answers **200**
- [ ] **Administration → Traitements** shows `generate-occurrences` as `SUCCEEDED`
- [ ] Dossiers appear in the **Échéancier**
- [ ] An invitation email genuinely arrives, and not in spam
- [ ] The first administrator has their second factor enrolled
- [ ] A backup has run, **and has been restored once**
- [ ] The **registers' expiry dates** are filled in
- [ ] The **religious holidays** for this year and next are entered
- [ ] The dashboard banner no longer shows `GENERATION_STALE`, `BACKUP_STALE` or
      `HOLIDAYS_INCOMPLETE`

⚠️ **The last three lines are the ones people postpone**, because nothing breaks
without them. They are also the three that produce wrong deadlines without saying
so: without expiry dates, register and licence renewals generate **no dossier**;
without public holidays, every deadline falling on a non-working day is wrong.

---

## VPS variant — if the data must stay in Algeria

The principle does not change: the same two pieces, on a machine you run.

1. **Server**: Debian 12 or Ubuntu 24.04, 4 GB of memory minimum, Docker
   installed.
2. **Self-hosted Supabase**: follow `supabase/docker` from the official
   repository. You then become responsible for security updates to Postgres,
   authentication and storage.
3. **The application**: build the image and serve it behind a reverse proxy.

```dockerfile
# Dockerfile — to be placed at the repository root
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
EXPOSE 3000
CMD ["npm", "start"]
```

4. **HTTPS**: Caddy, or nginx + certbot. ⚠️ Never plain HTTP — sessions travel
   over it.
5. **The scheduled jobs** work identically: `npm run cron:config` with the
   internal address the database can reach.

⚠️ **What the VPS really adds** is security updates, disk monitoring, log
rotation and disaster recovery. That is not an objection; it is the work to name
before choosing it.

---

## When something does not work

| Symptom                                  | Most common cause                                                     |
| ---------------------------------------- | --------------------------------------------------------------------- |
| The Vercel build fails naming a variable | It is missing — environment validation doing its job                  |
| No dossier appears                       | `cron:config` not run, or mismatched secrets. See `cron_dispatch_log` |
| Invitations do not arrive                | Resend DNS (SPF/DKIM) not set, or `SMTP_FROM` on another domain       |
| "Legal deadline passed" everywhere       | Historical backfill: `npm run db:backfill`, see `go-live.md` §B.5     |
| A role cannot see a screen               | That is the matrix speaking, not a fault. See the manual §2           |
| `GENERATION_STALE` on the dashboard      | Scheduling has fallen over. Redo step 5                               |

The day-to-day operations log is in `docs/runbook.md`; migration-by-migration
rollback in `docs/migrations-rollback.md`.
