# Decisions

Each entry says **what was decided**, **what it costs** and **what would make us
reconsider**. A decision whose price you cannot state was not taken, it was
suffered.

## Accepted gaps

Some entries do not describe an architectural choice but a **known gap**,
measured, which we decided was not worth its fix. Leaving them unsaid would turn
them into invisible debt; fixing them would cost more than they cost. They carry
the label at the top. As of today: § 15 (404 status).

---

## 1 · The database is the authority, the application explains

**Decided.** Compartmentalisation, transitions, completeness and traceability live
in SQL. Application code greys out buttons and names what is missing.

**Why.** An application-level guard is bypassed by any path that does not go
through it. The data tracked here is tax and social security filings.

**Cost.** Writing SQL, testing against a real database, accepting that unit
coverage of the orchestration services stays low.

**Reconsider if.** Never for convenience. Possibly if the platform stopped being
multi-domain — but then the product would have changed in nature.

---

## 2 · ADMIN has neither `occurrence.read` nor `document.read`

**Decided.** The technical administrator manages accounts, roles, settings and the
referential. They read no dossier and no document.

**Why.** Otherwise the person who installs the software becomes the best-informed
person in the company. An incident is diagnosed with `audit_log` and the
correlation id, not with the contents of a filing.

**Cost.** Support is a little less direct. A question about a dossier goes through
someone in the domain.

**Reconsider if.** Direction explicitly requires it — and then by recording it as a
decision, not as a convenience. Full detail in [security.md](./security.md).

---

## 3 · `style-src 'unsafe-inline'`, `script-src` strict

**Decided.** The CSP keeps a per-request nonce and `'strict-dynamic'` on
`script-src`. `style-src` allows `'unsafe-inline'`.

**Why.** Measured: with a nonce, server-rendered `style="…"` attributes are
refused — a nonce does not attach to an attribute. On a dossier at "0 of 2", the
completeness bar displayed **full**. Every gauge announced "complete".

**Cost.** A CSS injection becomes possible _if_ an injection flaw exists
elsewhere. No script executes as a result.

**Reconsider if.** The gauges move to a rendering that uses no style attribute —
an SVG `<rect>` in percentages, for instance. The nonce could then be reinstated
without breaking anything.

---

## 4 · The RLS function bodies are duplicated

**Decided.** `session_gates()` and its neighbours repeat their logic instead of
delegating to a `_for(p_user)` variant.

**Why.** Measured: factoring them out took `pending_validation_count()` from
**92 ms to over 30 s**. `security definer` + `set search_path` stop PostgreSQL
inlining, and the call becomes an optimisation barrier inside a policy evaluated
per row.

**Cost.** Two bodies to keep in step. A parity test compares them.

**Reconsider if.** PostgreSQL learns to inline these functions. To be verified by
measurement, not by the release notes.

---

## 5 · Due-date calculation is in TypeScript

**Decided.** The only business rule outside the database.

**Why.** The referential screen previews six deadlines **while you type**. In SQL
that would be a round trip per keystroke.

**Cost.** A rule not guarded by the database. Offset by the project's only
**100 %** coverage threshold, property tests (fast-check), and the fact that a
wrong deadline produces a visible date — not a leak.

**Reconsider if.** The preview disappears, or a regulatory rule becomes complex
enough to deserve being enforced at write time.

---

## 6 · No amount column

**Decided.** The platform tracks the process, not the figures.

**Why.** An amount calls for reconciliation, therefore accounting accuracy,
therefore a second source of truth to keep in step with the accounts.

**Cost.** Reports do not quantify financial exposure.

**Reconsider if.** Direction asks for it — and then by first deciding **which** is
authoritative, the accounts or this.

---

## 7 · Rate limiting is applied in the middleware

**Decided.** A single limit on the `next-action` header, 60 writes per minute per
user, counter in the database.

**Why.** It is the one point through which all sixty-one Server Actions pass. A
guard copied sixty-one times is a guard forgotten once.

**Cost.** One extra database call on every write. Reads pay nothing for it.

**Reconsider if.** A legitimate use exceeds the threshold — a bulk import, for
example. The threshold would then be raised for that path, not removed.

---

## 8 · Anonymous writes are not rate-limited by IP

**Decided.** With no session, no rate limit. Sign-in keeps its own, by email AND
by IP.

**Why.** Measured: a per-IP limit refused half the sign-ins of the end-to-end
suite, which connects from a single address. An office behind a shared connection
suffers exactly the same: twenty people counted as one.

**Cost.** An anonymous burst on an unauthenticated action is unbounded. The only
action of that kind is sign-in, already protected.

**Reconsider if.** An anonymous write is added — a public form, a webhook. That
path would then need its own limit.

---

## 9 · Navigations are RETRIED, not delayed

**Decided.** `useQueryNavigation` and the "Dossier" tab ask for the page again
until it has seen the change, with a doubling wait, bounded.

**Why.** Measured over about fifteen runs: `router.refresh()` or `router.replace()`
chained onto the end of a Server Action is **cancelled** by the browser
(`net::ERR_ABORTED`). Depending on machine speed, the screen updates or stays
frozen. Three shapes were tried and measured intermittent — including
`startTransition(async () => { await run(); router.refresh(); })`.

**Cost.** A few extra requests in the degraded case. FOUR simpler shapes were
tried and measured wrong:

1. fixed cadence — it duplicated its own in-flight navigation;
2. guarding on `pending` alone — an abandoned navigation leaves `pending` stuck at
   true FOREVER, and the retry was then never issued: permanent deadlock, greyed
   field, frozen URL;
3. a limit in NUMBER of attempts — the quota exhausted in two seconds, exactly
   when a loaded machine would have needed us to persist;
4. the condition read in the effect body — the effect does not re-run, `Date.now()`
   not being a dependency.

The shape retained combines all four lessons: a limit in DURATION (twenty
seconds), a doubling wait, `pending` read by REFERENCE inside the timer, and
rearming on every beat. A limit in number means the same thing on an idle machine
and on a saturated one; a limit in time adapts.

**Reconsider if.** Next.js fixes the cancellation. The stop condition being
factual — does the URL carry what we asked for — the code would stay correct, it
would simply stop retrying.

---

## 10 · Next.js 15, not 16

**Decided.** Stay on the line pinned by CLAUDE.md §2, while taking every patch
release on it.

**Why.** Exposure to the remaining advisories is verified nil: `next/image` is used
nowhere, no remote image pattern is declared, `postcss` only processes our own
stylesheets at build time. A major version bump decided alone, at the end of a
phase, would cost more than it fixes.

⚠️ **Updated 2026-09-27.** This entry used to say "three `high` vulnerabilities
fixed in 16" and implied nothing could be done on the 15 line. That had stopped
being true: `next` carried a **CRITICAL** advisory with a patch release available.
`15.5.22 → 15.5.26` was applied, along with `vitest` and `@vitest/coverage-v8`
`4.1.10 → 4.1.11`. Nine advisories became five; the critical one is gone.

**Cost.** `npm audit` still shows five, and you have to know why in order not to
get used to it.

⚠️ **The lesson is about the entry, not the package.** "No fix exists" ages into a
reason not to look. Patch releases on the pinned line are taken as they ship; only
the major bump waits for a maintenance window.

**Reconsider if.** One of the remaining advisories becomes reachable — adding a
`next/image` would be enough — or at the first planned maintenance window.

---

## 11 · `zustand` is declared but unused

**Observed** by `depcheck`, not decided.

CLAUDE.md §2 keeps it for ephemeral UI state, "minimal use". No screen has needed
it: state lives in the URL (shareable) or in a local `useState`. The dependency
stays installed because it is part of the approved stack; removing it is a charter
decision, not a code one.

**To settle** at the next dependency review.

---

## 12 · Coverage: thresholds on pure modules only

**Decided.** Per-file thresholds on calculation, validation, the state machine,
dates, `Result` and errors. Services that orchestrate the database are excluded.

**Why.** Covering them would mean mocking the Supabase client: the test would
measure the mock, not the rule — and the rule lives in RLS and SQL functions.
Those modules are exercised by `vitest.integration.mts` (real database) and by
Playwright (real application), whose coverage does not appear in this report.

**Cost.** The overall figure in the unit report does not describe the whole
project. Hence [testing.md](./testing.md), which says what each suite guarantees.

**Reconsider if.** An orchestration service takes a decision that is not guarded in
the database. It would then have to be moved, or genuinely tested.

---

## 13 · The locale travels by header, set by our middleware

**Decided.** `src/middleware.ts` sets `x-app-locale`, and `getRequestConfig` reads
it before falling back to `requestLocale`.

**Why.** next-intl populates `requestLocale` from ITS middleware, which this
project does not mount — ours carries the session, the CSP, correlation and rate
limiting. `requestLocale` therefore stayed empty and `resolveLocale(undefined)`
fell back to French: **the whole application rendered in French whatever the URL**,
and the 1,416 keys of the Arabic catalogue were never read.

The defect was invisible: `lang` and `dir` come from `params` and switched
correctly to `ar`/`rtl`. The page looked entirely Arabic, except the text.

`setRequestLocale` was tried first and is not enough: a page can resolve its
translations before the layout has called it. The header is set before any
rendering and depends on no execution order.

**Cost.** One more header, and a dependency on our middleware — accepted: it is
already the mandatory passage point of every request.

**Reconsider if.** `next/root-params` stabilises. It would replace both this header
and the two deprecation waivers that accompany it.

---

## 14 · Notification rules are exposed, not editable

**Decided.** `/admin/notifications` shows reminders and escalations read-only. The
write policies exist in the database, reserved to `settings.manage`; no form uses
them.

**Why.** A rule switched off by mistake breaks nothing visible: it removes
reminders, and the defect is only discovered at the first missed deadline.
Conversely, showing nothing forces you to open the database to answer "does the
rule exist?" — the first question asked when an alert does not arrive.

**Cost.** Changing an offset requires a migration, therefore a deployment. That is
slower than a click, and that is the point.

**Reconsider if.** Adjusting an offset becomes routine. It would then need a form
WITH explicit confirmation and an audit trail — not a plain toggle.

---

## 15 · A missing record answers 200, not 404

> **Accepted gap.** What follows is not an architectural choice: it is a known
> defect we are keeping, with its price quantified.

**Decided.** `notFound()` on a record — occurrence, document, obligation, register
— renders the "resource not found" screen with HTTP status **200**. We leave it as
is, and we do not move the existence check into the middleware.

**Why.** The real requirement was not the status code: it was
**indistinguishability** between "the resource does not exist" and "you are not
allowed to see it". Distinguishing the two would turn every record into an oracle:
guess an id, read the difference, and learn which dossiers exist in domains you are
not allowed to see. The list of a company's obligations says a great deal about its
troubles.

That property is established and **tested** — same status, identical rendered body,
comparable response time (`e2e/security.spec.ts`). No information leaks. The
security objective is met.

What remains is an imprecision of HTTP semantics, whose real consequences can be
counted:

| Feared consequence  | Here                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| Search indexing     | Private application, behind authentication. No crawler gets in.                                      |
| API consumers       | There are none.                                                                                      |
| Caching             | Dynamic authenticated pages, never put in a shared cache.                                            |
| External monitoring | A probe aimed at a record URL would count wrongly. That case does not arise — see `docs/runbook.md`. |

**The cause, measured.** `notFound()` only sets the code if it is thrown BEFORE the
response starts being written. The authenticated area's catch-all manages it: it is
a synchronous component, it throws before anything. A record, however, must first
read the session then the database to know whether the resource exists and whether
the caller may see it; on a dynamically rendered route, those awaits are enough to
commit the response. Verified: removing the `loading.tsx` files from the segment AND
its parent changes nothing, there is no other suspension boundary in the shell, and
`notFound()` from `generateMetadata` also fails — Next 15 streams metadata.

**Cost.** A watertight fix would mean moving the check into the middleware, so **one
database read per request**. That is exactly the pattern we just removed from the
RLS policies at the cost of several hours' work. Reintroducing it for cosmetic
accuracy would be a bad trade: we would pay on every request of every screen for a
number nobody reads.

**Reconsider if.** The application opens to API consumers, or external monitoring
needs to distinguish "gone" from "broken" on a specific resource. The first would
change the nature of the product; the second is answered by `/api/health`, without
touching the rendering.

---

## 16 · Scheduled-job configuration lives in a table, not in a Postgres setting

**Decided.** The addresses and the shared secret used by `pg_cron` live in
`cron_dispatch_config`, a table with **no policy and no grant**, read only by
`dispatch_cron_post` in `security definer`. Written by `npm run cron:config`.

**Why.** The original design used custom parameters
(`current_setting('app.…_url')`). Storing one durably requires SUPERUSER, which
Supabase grants neither on the hosted offering nor on the local stack — so the
setting would have stayed NULL for ever. Measured: `alter database … set app.x`
answers `permission denied to set parameter`.

`app_settings` was the other candidate and was rejected: it is readable by every
holder of `settings.manage`, and the shared secret has no business being visible to
an administrator.

**Cost.** One more table, and a script to run at each deployment or address change.
The script refuses a local address when the database is remote — a hosted database
calling `localhost` calls itself.

⚠️ **The function raises rather than posting without the secret.** Posting anyway
would produce a 401 lost inside `net._http_response`; an exception is recorded by
pg_cron in `cron.job_run_details`. The silence becomes a red line.

**Reconsider if.** Supabase grants a way to store a durable parameter, or a secrets
manager is introduced. Neither would change the guarantee, only where the value is
kept.

---

## 17 · Retention removes the files, keeps the records

**Decided.** Beyond `retention_live_years` (3 by default), document **files** leave
object storage; their **records** stay in `documents`, marked
`archived_offline_at` with a link to the archive that holds them.

**Why.** What takes up space is the attachments, not the rows: a year of activity
is a few hundred rows. And a record carries the SHA-256 fingerprint and the access
history — deleting it would make the evidence disappear along with the object. On a
compliance platform, being able to say "this document existed, here is its
signature, it is in the archive of such a date" is the whole point.

It also keeps CLAUDE.md's rule intact: no physical deletion of business data.

**Cost.** Consulting an old document requires restoring an archive. The link
`archived_in_backup_id` says which one — without it, you would restore archives one
by one until you found it.

⚠️ **Archiving is refused without a verified archive**: incomplete, unencrypted,
never restored, or **older than the last document of the year**. That last one is
the condition people forget, and the only one whose omission destroys data.

**Reconsider if.** Storage stops being the cost driver, or a legal obligation
requires immediate availability beyond three years. The setting changes without a
deployment.
