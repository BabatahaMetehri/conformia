# CONFORMIA — complete guide

Everything you need to do, in order, explained simply.

> **A note on language.** This guide is in English; **the application itself is in
> French**. Wherever a screen or button is named, the French label is given as it
> appears — `Échéancier`, `Registres`, `Mes tâches` — so you can match what you
> read here to what you see there.

This file is the **starting point**. The others go deeper:

| File                          | What it holds                                |
| ----------------------------- | -------------------------------------------- |
| `docs/deployment.md`          | Technical detail of the installation         |
| `docs/go-live.md`             | What must be settled before opening (French) |
| `docs/runbook.md`             | Day-to-day: what to do when something sticks |
| `docs/migrations-rollback.md` | Rolling a migration back                     |

---

## Part 0 · What you have to do, on one page

If you read only one thing, read this. The detail follows.

| #   | To do                                 | Where                 | Time   |
| --- | ------------------------------------- | --------------------- | ------ |
| 1   | Create the Supabase project           | supabase.com          | 10 min |
| 2   | Push the schema and the data          | your terminal         | 10 min |
| 3   | Wire up email (Resend + DNS)          | resend.com + your DNS | 30 min |
| 4   | Put the application online            | vercel.com            | 20 min |
| 5   | Wire up the automatic jobs            | your terminal         | 5 min  |
| 6   | Create your administrator account     | Supabase + the app    | 10 min |
| 7   | Invite the team                       | the app               | 15 min |
| 8   | Enter the religious public holidays   | the app               | 15 min |
| 9   | Complete the registers (expiry dates) | the app               | 15 min |
| 10  | Load the last three years             | your terminal         | 10 min |
| 11  | Take a backup **and restore it once** | your terminal         | 1 h    |

**Total: half a day**, including the restore drill.

⚠️ **Steps 8, 9 and 11 are the ones people postpone**, because nothing breaks
without them. They are also the three that produce silent errors: without public
holidays, any deadline falling on a non-working day is wrong; without expiry
dates, renewals generate **no dossier at all**; without a tested restore, you
have backup files and no idea whether they open.

---

## Part 1 · Why the app feels slow on your machine

**You are running it in development mode.** That is the whole cause, and it is
measured.

In development mode (`npm run dev`), Next.js **builds each screen the first time
you open it**. Measurements taken on your installation:

| Screen                 | 1st visit (dev) | 2nd visit (dev) | Production |
| ---------------------- | --------------- | --------------- | ---------- |
| Échéancier (deadlines) | 4,828 ms        | 550 ms          | 307 ms     |
| Registres (registers)  | 5,012 ms        | 576 ms          | 437 ms     |
| Documents              | 2,709 ms        | 254 ms          | 136 ms     |
| Référentiel            | 2,824 ms        | 370 ms          | 160 ms     |
| Mes tâches (my tasks)  | 1,965 ms        | 260 ms          | 105 ms     |

**In production everything is pre-built: 100 to 600 ms.** It is not a different
application that is slow — it is the mode.

### What I changed

1. **`npm run dev` now uses Turbopack.** First visit roughly halved: Registres
   5,012 → 1,604 ms, Documents 2,709 → 1,367 ms.
2. **Six screens showed nothing while loading** — including Registres, one of the
   slowest. The click did not respond, the previous page sat there frozen, and
   you clicked again thinking you had missed the button. They now show a skeleton
   immediately. That does not make the page faster; it makes the wait legible,
   which is the only part you can act on from here.

### What you should do

**To use the app normally, run the production build, even locally:**

```bash
npm run build     # once, after each code change
npm start         # then open http://localhost:3000
```

Keep `npm run dev` for editing code — that is its only purpose.

---

## Part 2 · Setting up Supabase

### 2.1 Create the project

1. Go to **supabase.com**, sign in, **New project**.
2. **Name**: `conformia-production`.
3. **Region**: `eu-central-1` (Frankfurt) or `eu-west-3` (Paris) — the closest to
   Algeria. ⚠️ **It cannot be changed afterwards.**
4. **Database password**: click _Generate_. ⚠️ It is shown **once only**. Copy it
   into the company safe immediately.

### 2.2 Collect four values

Under **Project Settings → API**:

| What you see   | What it is for                                   |
| -------------- | ------------------------------------------------ |
| _Project URL_  | the database address                             |
| _anon public_  | public key — harmless, it ships to the browser   |
| _service_role_ | ⚠️ **master key** — bypasses every security rule |

Under **Project Settings → Database → Connection string → URI**: the connection
string. Replace `[YOUR-PASSWORD]` with the password from the previous step.

⚠️ **The `service_role` key never goes** into a shared file, a message, a
screenshot, or any variable whose name starts with `NEXT_PUBLIC_`. If it leaks,
regenerate it from that same screen.

### 2.3 Push the schema

```bash
npm install -g supabase
supabase login
supabase link --project-ref <the-ref-in-your-dashboard-URL>
supabase db push
```

29 migrations apply. One to two minutes.

⚠️ **Never use the website's SQL editor for this.** A change made by hand does
not exist in the code: production drifts away from the repository, and the drift
is discovered at the next deployment — when it is too late to know what changed.

### 2.4 Load the referential and the registers

```bash
DATABASE_URL="postgresql://..." npm run db:seed
```

This installs the **23 obligations** (G50, IBS, CNAS, CASNOS, annual accounts…)
and AGROESPACE's **5 commercial registers**. Safe to re-run — nothing duplicates.

### 2.5 Check the two extensions

In the SQL editor:

```sql
select extname from pg_extension where extname in ('pg_cron', 'pg_net');
```

Both must appear. ⚠️ **Without `pg_net`, no automatic job runs at all** — and
they fail silently, in a log nobody opens.

---

## Part 3 · Email

**Without this part, nobody can be invited or notified.**

1. Create an account at **resend.com**.
2. **Domains → Add Domain**: `agroespace.dz`.
3. Resend shows **SPF** and **DKIM** records. Add them at your DNS host.
   ⚠️ **Without them, messages land in spam** — which looks a great deal like
   "the invitation never arrived".
4. **API Keys → Create**: that is your `RESEND_API_KEY`.

### Switching provider later

If AGROESPACE prefers its own mail server: **Administration → Réglages**
(settings), field `email_provider`, change `resend` to `smtp`. No redeployment.

⚠️ **This setting did not work until today.** The same parameter existed in two
places: the screen wrote one, the system read the other. The change saved,
displayed back correctly, and did nothing. Fixed — there is only one place now.

---

## Part 4 · Putting the application online

1. **vercel.com → Add New → Project** → import the repository.
2. Change none of the build settings: everything is detected.
3. **Add the environment variables** (Settings → Environment Variables):

| Variable                        | Value                                               |
| ------------------------------- | --------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | the project URL                                     |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the anon key                                        |
| `NEXT_PUBLIC_APP_URL`           | `https://conformia.agroespace.dz` (no trailing `/`) |
| `NODE_ENV`                      | `production`                                        |
| `SUPABASE_SERVICE_ROLE_KEY`     | the service_role key                                |
| `DATABASE_URL`                  | the connection string                               |
| `RESEND_API_KEY`                | the Resend key                                      |
| `SMTP_FROM`                     | `conformia@agroespace.dz`                           |
| `SMTP_HOST` `SMTP_PORT`         | Resend's, or your own server's                      |
| `SMTP_USER` `SMTP_PASSWORD`     | same                                                |
| `CRON_SECRET`                   | **generated** (see below)                           |
| `BACKUP_ENCRYPTION_KEY`         | **generated** (see below)                           |
| `LOG_LEVEL`                     | `info`                                              |

The two secrets are generated, never invented:

```bash
npm run secrets
```

⚠️ **`BACKUP_ENCRYPTION_KEY` is the only one whose loss is permanent.** It
encrypts the archives; without it your backups are unreadable forever. Put it in
the company safe **the day you generate it**.

4. **Deploy.**
5. **Settings → Domains**: add `conformia.agroespace.dz` and create the DNS
   record it shows. HTTPS is automatic.

---

## Part 5 · Wiring up the automatic jobs

This is the step people skip, and skipping it produces **no error message at
all**: simply no dossiers created and no reminders sent.

```bash
DATABASE_URL="postgresql://..." \
NEXT_PUBLIC_APP_URL="https://conformia.agroespace.dz" \
CRON_SECRET="<exactly the one in Vercel>" \
npm run cron:config
```

### Check it now — do not wait until 2 a.m.

In the SQL editor:

```sql
-- Trigger a call right now
select public.dispatch_cron_post('generate_occurrences_url');

-- Then, a few seconds later, look at the answer
select status_code, accepted from public.cron_dispatch_log
order by dispatched_at desc limit 3;
```

**`200` and `accepted = true`**: it is wired.
**`401`**: the two `CRON_SECRET` values are not identical.
**`404`**: the address is wrong.
**No rows at all**: `pg_net` is not installed.

Then, in the app: **Administration → Traitements** (jobs) must show a
`generate-occurrences` line with status `SUCCEEDED`.

⚠️ **None of these jobs worked before today**: the call was not authenticated,
the address could not be stored, and `pg_net` was not installed. Three of them
even pointed at routes that do not exist. Fixed — and a `GENERATION_STALE` alert
now appears on the dashboard if generation stops for more than 48 hours.

---

## Part 6 · Creating accounts

### 6.1 The first administrator — once, by hand

The application has no sign-up: you enter by invitation, and an invitation needs
an administrator.

1. Supabase → **Authentication → Users → Add user**.
   - work email address,
   - a long temporary password,
   - ⚠️ tick **Auto Confirm User**.
2. Copy the new account's UUID.
3. SQL editor — **the one and only exception to the rule**, and it touches no
   schema:

```sql
insert into public.user_roles (user_id, role_id, domain_id)
select '<the-account-uuid>', r.id, null
from public.roles r where r.code = 'ADMIN';
```

4. Sign in. ⚠️ **The app forces you to enrol a second factor before anything
   else**: the `ADMIN` role requires it. Install **Google Authenticator** or
   **Authy** on your phone **before** you start.
5. Change the temporary password.

### 6.2 Everyone else — by invitation

**Administration → Comptes → Inviter** (accounts → invite). The form asks for:

| Field                    | What goes in it                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------- |
| **Adresse** (email)      | the work address — this is both the login **and** where every reminder will be sent |
| **Nom** (name)           | full first and last name                                                            |
| **Téléphone** (phone)    | optional — `0550 12 34 56`                                                          |
| **Fonction** (job title) | optional — "Comptable", "Responsable RH"                                            |
| **Service**              | department, informational only                                                      |
| **Rôle** (role)          | see the table below                                                                 |
| **Domaine** (domain)     | restricts the role to one area, or _all_                                            |

⚠️ **Phone and job title are new.** The columns existed from the start but no
form ever filled them: they were empty on every account. You notice the day you
need the phone number of whoever owns an overdue dossier.

⚠️ **Job title is not the role.** A "Directeur financier" validates nothing
unless they hold `SUPERVISEUR` or `DIRECTION`. Permissions come from the role,
and from the role alone.

### 6.3 Which role for whom

| Person               | Role          | Domain     | Max duration |
| -------------------- | ------------- | ---------- | ------------ |
| The director         | `DIRECTION`   | all        | unlimited    |
| You                  | `ADMIN`       | —          | unlimited    |
| You (second role)    | `RESPONSABLE` | as needed  | unlimited    |
| The accountant       | `RESPONSABLE` | `FISCAL`   | unlimited    |
| Their stand-in       | `SUPPLEANT`   | `FISCAL`   | unlimited    |
| HR lead              | `RESPONSABLE` | `SOCIAL`   | unlimited    |
| Department head      | `SUPERVISEUR` | their area | unlimited    |
| External accountants | `EXTERNAL`    | `FISCAL`   | **365 days** |
| Statutory auditor    | `AUDITOR`     | all        | **90 days**  |

**Three things that surprise everyone:**

1. ⚠️ **An `ADMIN` sees NO dossiers.** No deadlines list, no documents, no
   validation queue — those menu entries do not even appear for them. That is
   deliberate: whoever hands out permissions should not be reading tax returns.
   If you also need to handle dossiers, **hold two roles**.
2. ⚠️ **You cannot give yourself a role.** The database refuses. You need a
   second administrator — that is what stops one person quietly granting
   themselves everything.
3. ⚠️ **Nobody validates their own dossier.** Not even with the supervisor role.

### 6.4 What the person receives

An email with a single-use link. **They choose their own password** — no password
is ever sent by email.

If the email does not arrive: check the DNS records (part 3), then the spam
folder.

---

## Part 7 · Notifications

### Two channels, both live

| Channel    | Where it lands                 | When               |
| ---------- | ------------------------------ | ------------------ |
| **Email**  | the address **on the profile** | every hourly cycle |
| **In-app** | bell icon, notification centre | immediately        |

Both go out together: the same alert leaves a trace in the app **and** in the
inbox.

### What triggers a send

**Administration → Notifications** sets the offsets: 30, 15, 7 and 1 day before
the deadline, then 1, 3 and 7 days after. Late alerts escalate to the stand-in,
then to the supervisor.

### Checking it works

Trigger a cycle without waiting:

```sql
select public.dispatch_cron_post('notifications_url');
```

then look at `cron_dispatch_log`. The response body says how many messages went
out (`"sent": N`).

⚠️ **A defect fixed today**: alerts raised by the database went out with an
unreadable subject — `notifications.backupStale.subject` instead of "Aucune
sauvegarde réussie récemment". Recipients were getting the internal label name.

---

## Part 8 · Archives, backups, and the three years

This is the most important part to understand, and the simplest once said.

### What actually takes up space

**Not the dossiers — the attachments.** A year of activity is a few hundred rows,
a few dozen kilobytes. Scanned declarations run to gigabytes, and they do not
live in the database but in object storage.

So retention is about **files**, not rows.

### The three years

- **Online**: the current financial year plus **3 closed years**. Immediately
  searchable.
- **Beyond that**: the files move into an encrypted archive. ⚠️ **The records
  stay in the database** — name, size, SHA-256 fingerprint, who uploaded it, who
  opened it. So you can always say "this document existed, here is its signature,
  it is in the archive of 15 January".

⚠️ **Three years online ≠ three years of retention.** Accounting obligations must
be kept far longer — the referential sets **ten years** per obligation type, and
nothing here touches that. What is capped at three years is what stays
_immediately searchable_.

The setting changes without a developer: **Administration → Réglages**,
`retention_live_years`.

### Seeing where you stand

```sql
select * from public.exercise_inventory;
```

One row per year: dossiers, documents, **bytes still online**, and whether the
year is past the window.

### Making an archive

```bash
npm run backup
```

Produces an **encrypted** archive of the database **and** the files, written to
`BACKUP_DESTINATION`.

### ⚠️ Restore it at least once

```bash
npm run restore:test
```

**An archive that has never been restored is not an archive: it is a file you
hope opens.** Do it once in full before opening to the team, then monthly.

### Loading an archive back

```bash
npm run restore -- --archive=/path/to/archive.tar.enc
```

This **replaces** the current contents. Do it on a test installation if you only
want to look at old data.

### Automatic backups

⚠️ **They are not triggered by the database**, and that is deliberate: a backup
writes to a disk AGROESPACE controls, which the hosted app cannot reach. You need
a machine that runs — an office PC left on overnight is enough.

**Windows**, Task Scheduler, daily at 02:00:

```
Program       : C:\Program Files\nodejs\node.exe
Arguments     : scripts\backup.ts
Start in      : C:\path\to\conformia
```

**Linux/macOS**, `crontab -e`:

```cron
0 2 * * *  cd /srv/conformia && npm run backup >> /var/log/conformia-backup.log 2>&1
0 3 1 * *  cd /srv/conformia && npm run restore:test >> /var/log/conformia-restore.log 2>&1
```

Supabase also takes its own daily backups. They do not replace yours: they live
at the same host as the data they protect.

---

## Part 9 · Loading the last three years

So your old paperwork has somewhere to go:

```bash
npm run db:backfill -- --months 36 --dry-run    # look first
npm run db:backfill -- --months 36              # then apply
```

This creates **archived shells** for the last 36 months.

⚠️ **They are created as ARCHIVED, never as "to do".** Creating them as "to do"
would manufacture hundreds of overdue dossiers on day one — and teach the team
that the overdue count means nothing.

⚠️ **Filing a document into an archived dossier requires reopening it** —
transition `ARCHIVED → SUBMITTED`, restricted to Direction, with a written
reason. It is heavier than it sounds: better to know now.

---

## Part 10 · Finding one specific dossier

**Échéancier** (deadlines), filter bar:

| Filter                       | What it does                                   |
| ---------------------------- | ---------------------------------------------- |
| **Année** (year)             | _(new)_ dropdown: 2025, 2026, 2027…            |
| **Période précise**          | `2026-03` for March only                       |
| **Établissement** (register) | one of the five registers                      |
| **Domaine**                  | fiscal, social, legal, regulatory              |
| **Organisme** (authority)    | DGI, CNAS, CASNOS…                             |
| **Responsable** (owner)      | the person in charge                           |
| **Statut**                   | to do, in progress, validated, filed, archived |
| **Criticité**                | critical, high, medium, low                    |
| **En retard** (overdue)      | toggle                                         |

⚠️ **Year and precise period write the same filter**, on purpose: the filter
matches a **prefix**. "2026" keeps the whole year, "2026-03" keeps March alone.
Picking a year widens; typing a month narrows.

Before today, filtering by year meant guessing that a free-text box accepted
"2026". Nobody guessed it.

The **Exporter** button produces an Excel workbook of whatever is filtered.

---

## Part 11 · Security — what was checked

Full schema audit. **What is sound:**

- no table without row-level security;
- no permissive access rule;
- no privileged function left misconfigured;
- no public storage bucket;
- tested with no session at all: `profiles`, dossiers, documents, settings and
  the audit log all return **zero rows**;
- sensitive functions defend themselves — `deactivate_user` and `reset_user_mfa`
  called without rights answer "user.manage required".

**Two doors closed:**

1. ⚠️ **The health probe was public.** Anyone, with no account, could read backup
   status, document counts and failed jobs — that is, learn **when destruction
   would hurt most**. Now restricted to the service role.
2. ⚠️ **`TRUNCATE` was granted to everyone** on 103 tables, inherited from
   Supabase's defaults. `TRUNCATE` **is not filtered by row-level security**: it
   empties a table without checking anything. Revoked, including for future
   tables.

### What you must do yourself

- ⚠️ **Second factor mandatory** for you and the director — enforced by the app.
- ⚠️ **The `service_role` key and `BACKUP_ENCRYPTION_KEY`** go in the safe, never
  in a message.
- **At least two administrators** — since nobody can grant themselves a role, a
  lone administrator cannot be rescued.
- **Remove leavers' access the same day**: Administration → Comptes → Désactiver.
  If the person owns dossiers, the app **requires** you to name a successor.

---

## Part 12 · Final checklist before opening

- [ ] `supabase db push` — 29 migrations
- [ ] `npm run db:seed` — 23 obligations, 5 registers
- [ ] `pg_cron` **and** `pg_net` present
- [ ] `npm run cron:config` done, and a manual call returns **200**
- [ ] Administration → Traitements shows `generate-occurrences` as `SUCCEEDED`
- [ ] Dossiers appear in the Échéancier
- [ ] An invitation email actually arrives (not in spam)
- [ ] Your second factor is enrolled
- [ ] A backup has run **and has been restored once**
- [ ] The **registers' expiry dates** are filled in
- [ ] The **religious public holidays** for this year and next are entered
- [ ] The dashboard no longer shows `GENERATION_STALE`, `BACKUP_STALE` or
      `HOLIDAYS_INCOMPLETE`

---

## Part 13 · When something does not work

| What you see                        | What it is                                                            |
| ----------------------------------- | --------------------------------------------------------------------- |
| The app is slow                     | You are in development mode. `npm run build && npm start`             |
| Deployment fails naming a variable  | It is missing — the validation is doing its job                       |
| No dossiers appear                  | `cron:config` not run, or mismatched secrets. See `cron_dispatch_log` |
| Invitations do not arrive           | Resend DNS records (SPF/DKIM) not set                                 |
| "Overdue" everywhere on day one     | Historical backfill: see part 9                                       |
| A role cannot see a screen          | That is the role matrix, not a fault                                  |
| `GENERATION_STALE` on the dashboard | Scheduling has fallen over. Redo part 5                               |
| `HOLIDAYS_INCOMPLETE`               | Next year's religious holidays are missing                            |

---

## Still waiting on you

1. **The religious holidays for 2026 and 2027** — Aïd el-Fitr, Aïd el-Adha, Awal
   Moharem, Achoura, Mawlid Ennabaoui. Set by decree each year; **they cannot be
   calculated**. Template ready: `docs/templates/jours-feries.csv`.
2. **Expiry dates for four of the five registers** — 58/00, 58/01, 47/06 and
   01/07. Only 58/04 (importation) has one, 27/11/2027.
   ⚠️ They change nothing _yet_: `AGR-SANIT` and `ETAB-CLASSE` are declared
   `ON_EVENT`, and those are never generated automatically. See the decision in
   point 5.
3. **The CASNOS declaration date** — January or February depending on the source.
4. **The three IBS instalments** (20/03, 20/06, 20/11) — to be confirmed.
5. **A decision, not a date**: should the renewal of the sanitary approval
   (`AGR-SANIT`) and of the classified-establishment authorisation
   (`ETAB-CLASSE`) be **planned automatically** from each register's expiry, or
   **created by hand** when the renewal is engaged? Today they are `ON_EVENT`, so
   nobody is reminded. Switching them to `ANNUAL` makes the platform raise the
   dossier thirty days before expiry — verified by measurement.

_Settled on 29/09/2026: the five register numbers and activities, and 58/00 as the
principal one._

⚠️ **None of these dates were guessed.** A wrong deadline produces no visible
error: only a reminder at the wrong moment, which the team then learns to rely
on.
