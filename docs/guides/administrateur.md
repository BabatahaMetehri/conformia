# Guide — Administrateur (administrator)

> Two pages. You own the **accounts**, the **roles**, the **settings** and the
> **referential**. You see **no dossier** and **no document** — read why before
> taking it for a fault: `pourquoi-admin-ne-voit-pas.md`.
>
> The app is in French; screen names below are given as they appear.

---

## What you see, and what you do not

```
  Mes tâches          ✓     Échéancier         ✗
  Référentiel         ✓     Documents          ✗
  Registres           ✓     À valider          ✗
  Absences            ✓     Tableau de bord    ✗
  Administration      ✓
  Journal d'audit     ✓
```

You administer **what describes** the obligations. You do not read **what fills
them in**. The distinction fits in one sentence, and it is the one to remember —
it is also the answer to give when you are asked.

⚠️ If you **also** need to consult dossiers: do not modify the `ADMIN` role,
**give yourself a second role** (`SUPERVISEUR` or `DIRECTION`) on your account.
Permissions add up, and the audit distinguishes which one you acted under.
Widening `ADMIN` would affect every administrator, present and future, without
anyone seeing it.

---

## Opening an account

**Administration → Utilisateurs → Inviter.**

An invitation sends a single-use link; the person chooses **their own** password.

⚠️ **You never set someone else's password.** The application does not allow it,
and that is the right regime: a password sent by email is a password that sits in
a mailbox for years.

The role is chosen at invitation time:

| Role          | For whom                                            |
| ------------- | --------------------------------------------------- |
| `RESPONSABLE` | Prepares dossiers                                   |
| `SUPPLEANT`   | Stands in — **same rights**, only the trace differs |
| `SUPERVISEUR` | Checks and validates                                |
| `DIRECTION`   | Second-level validation, owns the referential       |
| `AUDITOR`     | Read-only — **expires after 90 days**               |
| `EXTERNAL`    | Outside party — **expires after 365 days**          |

⚠️ The last two **require** an expiry date: the database refuses the grant without
one. Access given for an engagement must not outlive the engagement.

You can also record the person's **phone** and **job title** on the invitation;
both land on their profile when they accept. ⚠️ The job title grants nothing — a
"Directeur financier" validates nothing without `SUPERVISEUR` or `DIRECTION`.

---

## The second factor

MFA is **mandatory** for `ADMIN` and `DIRECTION`: the middleware blocks the
session until it is enrolled. It cannot be worked around, including by you.

If someone loses their phone: **Administration → Utilisateurs → Réinitialiser la
MFA**. They re-enrol at their next sign-in. ⚠️ Verify their identity by some means
other than email before doing it: that is the door people force first.

---

## Watching that the platform is running

**Administration → Travaux planifiés** (scheduled jobs). Each job, its last run,
its verdict.

⚠️ **What to watch for is not failure, it is SILENCE.** A job that fails says so;
a job that has stopped running says nothing. A last run more than twenty-six
hours old is the real signal.

Since migration 0025 the dashboard also raises **`GENERATION_STALE`** when
generation has not run for 48 hours — precisely because that silence used to look
like a quiet week.

Three alerts also arrive in your bell:

- **stale backup** — no successful backup for 36 hours;
- **integrity** — a document's fingerprint no longer matches. ⚠️ **Delete
  nothing**: the discrepancy is itself evidence;
- **permanent send failure** — an email exhausted its retries.

---

## The public holiday calendar — your annual appointment

**Administration → Référentiels → Jours fériés.**

⚠️ **Religious feasts are fixed by decree**: they cannot be calculated, they are
entered, every year. Without them, a deadline falling on a non-working day is
treated as a working day.

**The "récurrent" (recurring) checkbox now works.** It used to be purely
informative — ticked, saved, displayed, and with no effect whatsoever on the
calculation. A feast marked recurring in 2026 protected nothing in 2027, and
since the calendar only held 2026, **every** deadline computed for 2027 ignored
public holidays entirely. Nothing reported it: no error, no message, no failing
test.

Since the fix:

- **civil feasts with a fixed date** — 1 January, Yennayer, 1 May, 5 July,
  1 November — are entered **once**, ticked recurring, and apply to every year;
- **religious feasts** are entered year by year, **never ticked recurring**.
  Ticking one would project it onto every year at the same Gregorian date, which
  is wrong by construction, and would make the coverage check believe the year is
  complete.

⚠️ The dashboard raises **`HOLIDAYS_INCOMPLETE`** while next year holds no
religious feast at all. It will not switch itself off: their absence is never a
normal state, always an oversight. Check coverage with:

```sql
select * from public.holiday_calendar_coverage;
```

Every 1 December the tool creates a dossier in **your** tasks: "Mise à jour du
calendrier des jours fériés N+1". That is your reminder: it does not depend on
your memory.

---

## What you cannot do, and that is normal

- **Read a dossier or a document.** See above.
- **Create a delegation for someone else.** You can **revoke** one, never consent
  to one on a third party's behalf.
- **Modify the audit log.** Nobody can, including you. It is write-only by
  construction of the database.
- **Delete an obligation or a register.** You **deactivate**; the history must
  stay readable.
