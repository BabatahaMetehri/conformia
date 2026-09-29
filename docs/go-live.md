# Go-live

This document is an **execution list**, not a presentation. Each section says
what to do, in what order, and how you recognise it is done. Anything with no
observable criterion is not a step: it is an intention.

⚠️ **Nothing below can be delegated to the tool.** The application is ready; what
remains comes down to secrets, real data, people and infrastructure — four things
no code can produce for you.

> The app is in French; screen names below are given as they appear.

---

## Where the repository stands

Done, verifiable, already in the code:

| Point                     | State                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------- |
| Development artefacts     | None. No demo screen, no test route, no seeded account.                                                 |
| Seed data                 | `supabase/seed/` holds only the business referential — no accounts, no fictitious data.                 |
| Production guard rail     | `scripts/seed.mjs` and `scripts/create-user.mjs` refuse `NODE_ENV=production` **and** any non-local db. |
| Secrets in the repository | None. `gitleaks` passes over the full history.                                                          |
| Continuous integration    | `.github/workflows/ci.yml` — blocking, with no optional step.                                           |

⚠️ **Two items from the original list never existed**: there was never a
`/_design-system` route, nor a `dev_users.sql` file. The only tool that creates
accounts is `scripts/create-user.mjs`, now guarded.

---

## A · Secrets

### Where each secret lives, and who can read it

| Secret                          | Issued by         | Lives in                                     | Read by                     |
| ------------------------------- | ----------------- | -------------------------------------------- | --------------------------- |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase          | Host variables + the browser                 | Everyone — that is its job  |
| `SUPABASE_SERVICE_ROLE_KEY`     | Supabase          | Host variables, **server only**              | The scheduled jobs          |
| `DATABASE_URL`                  | Supabase          | Host variables                               | Migrations, backup          |
| `RESEND_API_KEY`                | Resend            | Host variables                               | The notification dispatcher |
| `CRON_SECRET`                   | `npm run secrets` | Host variables **and** the scheduler         | Both, and nobody else       |
| `BACKUP_ENCRYPTION_KEY`         | `npm run secrets` | **The company safe, outside infrastructure** | See below                   |

```bash
npm run secrets          # produces CRON_SECRET and BACKUP_ENCRYPTION_KEY
```

The script **writes to no file**. It prints, you copy, the terminal closes. A
script that filled in `.env.local` would eventually fill a file tracked by git,
on a day someone ran it from the wrong directory.

### Rotation order — it matters

1. **`RESEND_API_KEY`** — create the new one, deploy it, **then** revoke the old.
   The reverse cuts notifications between the two moves.
2. **`CRON_SECRET`** — set the same value on **both** sides at the same moment. A
   mismatch shows no error: deadlines simply stop being generated, and that is
   only noticed at the first one missed.
3. **Supabase keys** — "Rotate" invalidates the old one **immediately**. Stage the
   replacement in the host variables first, rotate second, redeploy right after.
4. **`BACKUP_ENCRYPTION_KEY`** — see the next section. It does not rotate like the
   others.

### ⚠️ `BACKUP_ENCRYPTION_KEY` — the only one whose loss is irreversible

This key encrypts the archives. **A backup whose key is lost is not a backup**:
it is a file nobody will ever open, including you, including the host, including
with a court order.

Three rules, and they are not negotiable:

1. **Outside the application infrastructure.** Not in the host variables next to
   everything else, not in the repository, not in a password manager hosted by
   the same provider as the database. An incident that takes out the
   infrastructure must not take out the key that gets you back from it.
2. **Outside the backups.** Encrypting the key with itself makes no sense;
   including it in cleartext inside the archive cancels the encryption.
3. **Two copies, in two places, known to two people.** One copy is a single point
   of failure; one person who knows it is a single point of failure that takes
   holidays.

**Recommended form**: the key printed on paper, in a sealed envelope, in
AGROESPACE's safe — plus a second copy held by the director. Paper does not
corrupt, depends on no file format, and is not copied by accident.

**Recovery — the procedure, to be re-read once a year:**

```bash
# 1. Retrieve the archive and the key (two different places, by construction)
# 2. Check the key is the right one BEFORE you need it:
BACKUP_ENCRYPTION_KEY="…" npm run restore:test
#    → restores into a disposable database and compares fingerprints.
#    If this command fails, the key is not the right one. Knowing that now
#    costs five minutes; knowing it on the day of the incident costs the company.
```

⚠️ **If the key must change**: produce the new one, **keep the old** — archives
already written stay encrypted with it — and note the switch-over date next to
each copy. A key replaced without keeping the previous one makes the whole
history unreadable at once.

---

## B · Production data

### 1. Public holidays — ⚠️ **the most urgent point on this list**

**Observed state:** the database holds **five** public holidays, all civil and at
fixed dates:

| Date  | Feast                         |
| ----- | ----------------------------- |
| 01/01 | New Year                      |
| 12/01 | Yennayer                      |
| 01/05 | Labour Day                    |
| 05/07 | Independence Day              |
| 01/11 | Anniversary of the Revolution |

**What is missing, and what it costs:**

- **The religious feasts for 2026 AND 2027** — Aïd el-Fitr, Aïd el-Adha, Awal
  Moharem, Achoura, Mawlid Ennabaoui. They follow the Hijri calendar and are set
  **by decree**. They cannot be calculated: no code can guess them, and this
  document does not invent them. Without them, a deadline falling on Aïd is
  computed as a working day — and the regulatory shift is not applied.

**`is_recurring` — FIXED.** ⚠️ The trap was real and silent: the column was read,
displayed, ticked by administrators, and had **no effect whatsoever**. The engine
received exact dates, so a feast marked "recurring" in 2026 protected nothing in
2027 — and since the calendar only held 2026, **every** deadline computed for
2027 ignored non-working days. Nothing reported it: no error, no message, no
failing test.

Recurring entries are now **projected** onto each year requested
(`src/lib/holidays.ts`), so the five civil feasts above apply to 2027, 2028 and
beyond **with no further entry**. What remains to be entered each year are the
only dates that can be deduced from nothing: the religious ones.

**The guard rail.** A year in the horizon with **no** exact date is never a normal
state — it is always an oversight. It is therefore reported three ways:

| Where                       | What                                                                       |
| --------------------------- | -------------------------------------------------------------------------- |
| Generation log              | `Calendrier des jours fériés incomplet`, with the years and consequence    |
| Dashboard                   | `HOLIDAYS_INCOMPLETE` alert, restricted to holders of `referential.manage` |
| `holiday_calendar_coverage` | control view: `year, civil_count, religious_count, is_complete`            |

To check the state at any time:

```sql
select * from public.holiday_calendar_coverage;
```

A row with `is_complete = false` names a year whose deadlines ignore non-working
days. **The alert will not switch itself off**: it is built to stay visible until
the entry is made.

**To do:** obtain from the accountants or the Official Journal the list of
non-working days for **2026 and 2027**, then enter them under **Administration →
Référentiels**, by hand or by CSV import.

The template is provided: [`docs/templates/jours-feries.csv`](templates/jours-feries.csv).
Format `date,label,recurring`, the date as `YYYY-MM-DD`.

⚠️ **`recurring` is `false` for every religious feast**, without exception.
Marking one `true` would project it onto every year at the same Gregorian date —
wrong by construction — and, worse, would make the guard rail believe the year is
covered. The only legitimate `true` is on the five civil feasts, already entered.

**The impact is announced before it is applied.** Adding, importing or removing a
public holiday moves deadlines that people have written down elsewhere. The screen
quantifies the shift **before** writing, and declining writes nothing. Only `TODO`
dossiers move: those already started, validated, filed or archived are never
touched.

**The annual reminder — fixed.** The job meant to create the "Mise à jour du
calendrier N+1" dossier every 1 December was written, tested… and **called by
nobody**: no pg_cron, no route, no job. It would never have fired. Two further
defects came with it: no date guard (it would have recreated the dossier every
morning) and two `ON CONFLICT` clauses naming constraints that do not exist, which
made it fail on its first real run. Fixed, grafted onto the daily generation, and
exercised by `tests/integration/holiday-reminder.test.ts`.

### 2. Commercial registers

The **five AGROESPACE registers are seeded** by
`supabase/seed/0003_registres_agroespace.sql`, as confirmed by the administration
on 29/09/2026:

| Number | Activity    | Wilaya    | Expires          |
| ------ | ----------- | --------- | ---------------- |
| 58/00  | principal   | El Meniaa | _to be supplied_ |
| 58/01  | service     | El Meniaa | _to be supplied_ |
| 58/04  | importation | El Meniaa | **27/11/2027**   |
| 47/06  | irrigation  | Ghardaïa  | _to be supplied_ |
| 01/07  | adrar       | Adrar     | _to be supplied_ |

⚠️ **The four missing expiry dates are the one thing still outstanding.**
Corrections and additions are made on the **Registres** screen.

⚠️ **The expiry date does nothing on its own today, and that is worth knowing.**
`AGR-SANIT` and `ETAB-CLASSE` are anchored on it, but both are declared
`ON_EVENT` — and `ON_EVENT` obligations are deliberately never generated
(`listGeneratableObligations` excludes them at source: they are born of a fact,
not of the calendar). So the date is stored and read by nothing.

The generator _does_ contain the path that would use it: a `PER_REGISTER`
obligation whose register carries `expires_at` plans its renewal ahead of the
expiry. Measured by temporarily switching `AGR-SANIT` to `ANNUAL`: two dossiers
appeared, **for 58/04 only** — the one register with a date — due 28/09/2027,
thirty days before its 27/11/2027 expiry, exactly as the rule specifies.

⚠️ **So there is a decision to take, and it is a referential one, not a technical
one**: should renewal of the sanitary approval and of the classified-establishment
authorisation be _planned_ from the register's expiry (periodicity `ANNUAL`), or
_created by hand_ when the renewal is actually engaged (`ON_EVENT`, as today)?
Planning them gives reminders; leaving them as they are means nobody is warned.
The expiry dates are worth collecting either way — they become useful the moment
that decision is made.

⚠️ **The type drives generation.** A `PER_REGISTER` obligation produces a dossier
**per active register**. One register too many is a column of dossiers too many,
every year.

### 3. Reviewing the 23 obligations

The delivered referential holds **23** obligations (not 22). For each:

- **does it apply?** If not: deactivate it, do not delete it — the history must
  stay readable;
- **`ENTITY` or `PER_REGISTER`?** An obligation that applies to the whole company
  must not multiply per establishment;
- **is the deadline right?** The screen shows the next six computed dates: that is
  where a wrong rule shows.

### 4. Deadlines — one corrected, one still open

**CNAS-DAS — CORRECTED.** The starting value was **31 March**; it is **31
January**. ⚠️ The error ran in the direction that costs: it suggested two months
remained. The delivered referential now carries the right date, and the internal
deadline falls fifteen working days earlier — verified: period 2026, legal
deadline 31/01/2027, internal 10/01/2027.

**CASNOS — PARTIALLY RESOLVED. This is the project's last open question.**

The obligation is two things, and the referential carried only one half:

| Step                            | Date                           | State                                                        |
| ------------------------------- | ------------------------------ | ------------------------------------------------------------ |
| **Payment** of the contribution | 30 June                        | **Confirmed.** That is the `CASNOS` line, renamed to say so. |
| Prior **declaration**           | end of January **or** February | ⚠️ **Not confirmed. No obligation created.**                 |

⚠️ **The missing obligation was deliberately not created.** Creating it with a
guessed date would be worse than its absence: a wrong deadline produces no visible
error, only a reminder at the wrong moment — and the team would learn to rely on
it. An absent obligation at least gets noticed.

**To do, as soon as the date is confirmed:** Référentiel → Nouvelle obligation,
domain SOCIAL, authority CASNOS, annual periodicity, fixed-date anchor. The next
six dates are shown before saving: that is where a typing error shows.

**Also still to confirm:** the three IBS instalments (20/03, 20/06, 20/11), taken
without a firm source.

Every correction is made in the interface, with immediate preview. A recomputation
of **future** occurrences is offered after a change; past dossiers never move.

### 5. Historical backfill

```bash
npm run db:backfill -- --months 36 --dry-run   # read first
npm run db:backfill -- --months 36             # then apply
```

Creates shells for the preceding months at status **ARCHIVED**: they appear in no
queue and count towards no overdue figure. Without them, a March supporting
document has nowhere to go.

⚠️ **Know this before filing an old document**: an archived occurrence is
immutable. Filing a document into it means **reopening** the dossier (transition
`ARCHIVED → SUBMITTED`, permission `occurrence.unlock`, mandatory reason). That is
heavier than the original intention suggested.

---

## C · Real accounts

### Bootstrapping the first administrator

The application has no sign-up: you enter by invitation, and an invitation needs
an administrator. That knot is cut **once**, by hand:

```sql
-- On the production database, via the Supabase SQL console, once.
-- 1. Create the account through the Supabase interface (Authentication → Add user),
--    with a long temporary password, sent over a separate channel.
-- 2. Grant it the ADMIN role:
insert into public.user_roles (user_id, role_id, domain_id)
select '<account-uuid>', r.id, null
  from public.roles r where r.code = 'ADMIN';
```

Then, **at the first sign-in**: change the password and **enrol MFA immediately**.
The middleware already enforces it for ADMIN and DIRECTION — the first session
goes nowhere without a second factor.

⚠️ `scripts/create-user.mjs` **cannot** be used here: it refuses any non-local
database, deliberately.

### Every other account — by invitation, never by imposed password

Screen **Administration → Utilisateurs → Inviter**. The invitation sends a
single-use link; the person chooses their own password. No password travels by
email — that is the only acceptable regime, and the application offers no other.

| Person         | Role                                    | MFA           |
| -------------- | --------------------------------------- | ------------- |
| You            | `ADMIN` **+** a second role (see below) | **Mandatory** |
| The director   | `DIRECTION`                             | **Mandatory** |
| The preparer   | `RESPONSABLE`                           | Recommended   |
| Their stand-in | `SUPPLEANT`                             | Recommended   |
| The checker    | `SUPERVISEUR`                           | Recommended   |

### ⚠️ Your own account — hold both, do not widen

The `ADMIN` role gives access **neither to dossiers nor to documents**. That is
deliberate, it is tested (`e2e/critical-journeys.spec.ts`, journey 5), and it is
explained in `docs/security.md`.

If you also need to consult dossiers: **give yourself a second role** —
`SUPERVISEUR` or `DIRECTION` — on the same account. Holding both is provided for
by the model: permissions add up, and the audit trail always distinguishes which
one you acted under.

**Do not widen `ADMIN`.** Giving it `occurrence.read` would make the person who
installs the software the best-informed person in the company, and would break the
one separation this model really protects.

### Time-bounded accounts

```sql
-- No AUDITOR or EXTERNAL should exist without an expiry.
-- The database already enforces it (constraint + max_duration_days); we VERIFY:
select p.email, r.code, ur.expires_at
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  join public.profiles p on p.id = ur.user_id
 where r.code in ('AUDITOR', 'EXTERNAL')
   and ur.revoked_at is null
   and ur.expires_at is null;
-- Expected result: zero rows.
```

---

## D · Backup — for real

### The rehearsal, once, in full

```bash
npm run backup                      # 1. a real full backup
npm run restore:test                # 2. restore into a disposable database
```

⚠️ **Time the restore and record the duration** in `docs/runbook.md`, section
"Restore duration". An unknown duration is a duration you will discover on the day
of the incident, in front of someone waiting for an answer.

### Does the encrypted copy really reach AGROESPACE?

`BACKUP_DESTINATION` or `BACKUP_RCLONE_REMOTE` must point at a location
**controlled by the company** — a dedicated machine or a NAS. A backup that stays
on the machine being backed up is not one.

Check, on site: the file is there, its size is plausible, and **a second person
knows where it is and how to reach it**. A backup only one person can find has the
reliability of that person.

### ⚠️ Cut the chain for 40 hours — the drill that counts

The threshold is **36 hours** (`BACKUP_STALE_AFTER_HOURS`). Forty hours clears it
comfortably.

```sql
-- Simulate the absence of backups without breaking anything:
update public.backup_runs
   set finished_at = now() - interval '40 hours'
 where status = 'SUCCEEDED';
```

Then wait for the hourly notification cycle (minute 5 of each hour).

**What must be observed:** the alert arrives **in a real person's inbox**, and not
only in a table. If it does not, the alerting mechanism is decorative — and the
classic failure is not the backup that fails, it is the one that fails **silently
for eight months**.

---

## E · Monitoring

| To wire up           | Onto what                       | Criterion                                             |
| -------------------- | ------------------------------- | ----------------------------------------------------- |
| External probe       | `GET /api/health`               | `503` raises an alert                                 |
| Error tracking       | Server + browser                | A triggered error shows up, **with no personal data** |
| Job failure          | `job_runs.status = 'FAILED'`    | Alert                                                 |
| **Absence** of a job | `job_runs` with no run for 26 h | Alert — silence kills, not failure                    |

⚠️ **Do not point the probe at a record URL.** It answers `200` even for a resource
that is gone — an accepted gap, `docs/decisions.md` § 15 — and would reassure
instead of alerting. `/api/health`, and nothing else.

Since migration 0025 the dashboard also raises **`GENERATION_STALE`** after 48
hours without generation — the in-app counterpart of the "absence of a job" line
above.

**Actually send each kind of alert once**, and confirm receipt: upcoming deadline,
overdue, escalation, awaiting validation, rejection, stale backup, integrity, send
failure. An alert never received is an alert nobody knows works.

---

## F · Security under real conditions

To be run **on the deployed environment**, not locally:

- **CSP with nonce** — open every screen with the console open: zero violations. A
  CSP that refuses a style shows no error, it shows a wrong screen.
- **Rate limiting** — check that a burst of writes really returns `429`.
- **Headers** — external scanner (`securityheaders.com` or equivalent). HTTPS
  forced, **HSTS active**.
- **Route Handlers** — for each: with no session, with an insufficient session,
  then with the right one. Three distinct answers expected. `e2e/security.spec.ts`
  already does this locally; do it again online.
- **Anonymous RPC** — verified locally after migration 0027: `health_snapshot` now
  answers `401` without a session, and every business table returns zero rows.
  Re-run the same probe against the deployed URL.

---

## G · Deployment

### Staging

A faithful mirror: same migrations, same variables (different values),
**fictitious data**. That is where migrations and restores are rehearsed.

### Migrations

```bash
supabase db push        # never through the web interface
```

⚠️ **Never the interface's SQL editor.** A migration applied by hand does not exist
in the repository: staging and production diverge silently, and the divergence is
discovered at the next deployment.

**Rollback per migration** — the table lives in `docs/migrations-rollback.md`.
Every new migration adds a line to it **in the same commit**.

### Continuous integration

`.github/workflows/ci.yml` — blocking, with no optional step. Types, lint, format,
unit tests, migrations, types up to date, integration (RLS, policies, jobs), build,
end-to-end, and `gitleaks` over the full history. **No deployment without a green
run.**

### Rollback plan

| Question                   | Answer                                                                                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Who decides?**           | You, or the director in your absence. One person, named in advance.                                                                                                          |
| **On what grounds?**       | A corrupted dossier, a wrong deadline in production, a data leak, a screen inaccessible to a role.                                                                           |
| **How long does it take?** | Redeploying the previous version: minutes. Rolling back a migration: see `docs/migrations-rollback.md`. Full restore: **duration to be measured** (section D).               |
| **How?**                   | 1. Redeploy the previous commit. 2. If a migration is at fault, apply its documented rollback. 3. If data is corrupted, restore — and accept the loss since the last backup. |
| **Who tells the users?**   | You, before the rollback, not after.                                                                                                                                         |

⚠️ **This plan must be read by someone who did not write it.** A rollback plan
reviewed by its author tests only its own internal consistency.

---

## H · Pilot

### One full monthly cycle, one single user

Open it to the **owner alone**. One verifiable objective: **one real G50 handled
end to end in the tool** — taken on, documents uploaded, submitted, validated,
actually filed, archived.

**Do not open it to the others before the cycle ends.** A friction met by one
person gets fixed; the same friction met by five becomes an opinion about the
tool.

### Record every friction, however minor

One file, one line per friction: date, screen, what was expected, what happened.
⚠️ **The minor ones above all**: they are what decides whether the tool is adopted
or worked around. A major friction reports itself; a minor one is worked around in
silence, and the workaround becomes the practice.

### Training

One guide **per role**, two pages maximum, illustrated — `docs/guides/`. One
session of **30 minutes per person**, on their own dossiers, not on an example.

### ⚠️ The question that will come back

> "Why can't the administrator see the documents?"

It will come back, it will look like a bug, and the answer is in
`docs/guides/pourquoi-admin-ne-voit-pas.md`. Read it **before** the first session:
an improvised answer is always less convincing than a prepared one, and this one
defends itself very well.
