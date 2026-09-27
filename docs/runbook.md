# Operations runbook

Read this when something is wrong, or before touching it.

> Screen names are given as they appear in the app, which is in French.

## Check the state in ten seconds

```bash
curl -s http://localhost:3000/api/health | jq
```

Three possible verdicts:

| `status`   | Meaning                                     | HTTP code |
| ---------- | ------------------------------------------- | --------- |
| `ok`       | Everything answers, everything ran recently | 200       |
| `degraded` | The platform serves, but a job is behind    | 200       |
| `down`     | Database or storage unreachable             | **503**   |

The detail (dates, staleness, counters) is only returned with the
`x-cron-secret` header: "the last backup is six days old" is not a sentence to
publish.

```bash
curl -s -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/health | jq .detail
```

The **Administration → Travaux planifiés** screen (`/fr/admin/jobs`) says the same
thing more legibly, with the run history.

### ⚠️ What external monitoring MUST NOT be pointed at

If an external probe is ever set up, it queries **`/api/health`**, and nothing
else.

In particular: **do not point a probe at a record URL** —
`/fr/echeancier/<id>`, `/fr/documents/<id>` — to detect that a resource has
disappeared. Those screens render the "not found" state with status **200**,
deliberately: see `docs/decisions.md` § 15. A probe counting status codes would
always see success there, including after the record was deleted — it would
reassure instead of alerting, which is worse than having no probe at all.

A record also requires a valid session: without one the answer is a 307 redirect
to the login page, and the probe would be measuring authentication, not
availability.

## Symptoms, and what they mean

### "This month's deadlines are not showing up"

Generation did not run. Check:

```sql
select job_name, status, started_at, finished_at, processed_count, error_count
from public.job_runs where job_name = 'generate-occurrences'
order by started_at desc limit 5;
```

- **No rows** → the scheduler no longer fires. Check `pg_cron`:
  `select * from cron.job;`
- **Status stuck at `RUNNING`** → an interrupted process. The advisory lock is
  released when the session ends; restarting the job is normally enough.
- **Status `PARTIAL`** → some obligations failed, the rest succeeded. `details`
  says which. That is deliberate: saying "succeeded" would hide the obligations
  that were not processed, saying "failed" would hide the ones that were.

Manual re-run:

```bash
curl -X POST -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/cron/generate
```

⚠️ **Re-running is idempotent.** It creates no duplicates: the
`(entity, obligation, period)` key is unique.

### "Reminders have stopped going out"

```sql
select count(*) from public.notifications where sent_at is null and scheduled_for <= now();
```

A climbing number means the dispatcher is no longer running. Same diagnosis as
above with `job_name = 'process-notifications'`. Re-run:

```bash
curl -X POST -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/cron/notifications
```

⚠️ **A send failure never interrupts the batch**: the notification is marked
failed, `retry_count` goes up, and processing continues. One invalid address must
not deprive forty people of their reminder.

### "A user cannot see a dossier they should see"

In order, skipping none:

1. **Does their role carry the permission?** → `/fr/admin/roles`
2. **Does their role cover the domain?** `user_roles.domain_id` — `NULL` = all.
3. **Is the role still live?** `revoked_at is null` and `expires_at` not past.
4. **Does RLS return the row?** Check UNDER THEIR SESSION, never as `postgres`:

```sql
begin;
select set_config('request.jwt.claims', '{"sub":"<their-uuid>","role":"authenticated"}', true);
set local role authenticated;
select id, period_key, status from public.obligation_occurrences where id = '<dossier>';
rollback;
```

Zero rows here means RLS is refusing, and that is the answer. The problem is then
in the assignment, not in the application.

### "An administrator is stuck on the enrolment screen"

That is the intended behaviour: `ADMIN` and `DIRECTION` do not get through
without a second factor. Two real causes:

1. **TOTP disabled on the Supabase side.** Symptom: the screen shows "An
   unexpected error occurred" instead of the QR code. Check `[auth.mfa.totp]` —
   both `enroll_enabled` AND `verify_enabled` set to `true`. This is the most
   severe failure in the system: it locks out every administrator account.
2. **Lost factor** (changed phone). Reset by another holder of `user.manage`:
   `/fr/admin/users` → reset the second factor. The action is traced
   (`MFA_RESET`) and requires a written reason.

⚠️ **If NO administrator can get in any more**, the escape hatch goes through the
database:

```sql
-- Lifts the requirement long enough to restore a factor. PUT IT BACK afterwards.
update public.app_settings set value = 'false' where key = 'require_mfa_all_users';
delete from auth.mfa_factors where user_id = '<the administrator uuid>';
```

### "The screen does not update after an action"

A known defect, fixed, but whose shape can reappear elsewhere:
`router.refresh()` chained onto a Server Action **is cancelled** by the browser.
The fix chosen does not rest on a delay but on a factual stop condition — ask for
the page again until it has seen the change, a bounded number of times. See
`src/hooks/use-query-navigation.ts` and `occurrence-checklist.tsx`.

If a new screen shows the symptom, look for a `router.refresh()` or
`router.replace()` called right after an action.

### "Too many requests" (429)

The user exceeded 60 writes in one minute. In real use this almost always signals
a tab left open on an action that re-fires by itself. Check:

```sql
select subject, count(*) from public.rate_limit_hits
where occurred_at > now() - interval '5 minutes'
group by subject order by count(*) desc limit 5;
```

## Backups

Full procedure: [backup-strategy.md](./backup-strategy.md) and
[restore-procedure.md](./restore-procedure.md).

⚠️ **The alert that matters**: no successful backup for 36 hours triggers a
notification to administrators (`notify_admins_of_stale_backup`). As long as
nobody feeds `backup_runs`, that alert stays on **permanently** — and that is the
intent: an absent backup system must not look like a silent one.

Monthly restore drill: `npm run restore:test`. That is **the only thing that
turns "we have backups" into a fact**; everything else says a file exists.

### Restore duration — to be filled in after the first real restore

⚠️ **An unknown duration is a duration you will discover on the day of the
incident**, in front of someone waiting for an answer. The figure below is
measured once, then confirmed at each monthly drill.

| Measured on  | Database size | Documents size | Total duration | By whom |
| ------------ | ------------- | -------------- | -------------- | ------- |
| _to fill in_ |               |                |                |         |

What to time: **from the decision to restore to the application answering**, not
just the command. Downloading the archive from the NAS and bringing the service
back up are part of it — and they are the parts that surprise.

⚠️ Copy this duration into the rollback plan as well
(`docs/go-live.md`, section G): that is where it will be looked for.

## Diagnosing with the audit log

Every business write leaves a row. Since migration 0016 it carries the request's
**correlation id**.

```sql
-- Everything one request produced
select occurred_at, action, entity_table, entity_id_ref, actor_email
from public.audit_log where request_id = '<uuid>' order by occurred_at;

-- Everything one person did today
select occurred_at, action, entity_table, entity_id_ref
from public.audit_log
where actor_email = 'x@agroespace.dz' and occurred_at > current_date
order by occurred_at desc;
```

The id is also returned in the `x-request-id` header of every response: a user
reporting an incident can quote it, and the server log, the audit row and their
screenshot line up without any investigation.

⚠️ `audit_log` is **append-only**, enforced by trigger. No `UPDATE`, no `DELETE`,
including as `postgres` without explicitly disabling the trigger.

## Measure before optimising

```bash
npm run db:plans      # docs/query-plans.md, under a user session (RLS applied)
npm run load-test     # 50 concurrent sessions
```

⚠️ A plan captured as `postgres` says nothing useful: the `security definer`
functions behind RLS are not inlined, and the gap reaches one to two orders of
magnitude.

Reference measured on the development machine (one Node instance, local
database):

| Measure                      | Value     |
| ---------------------------- | --------- |
| Page, single user            | ~100 ms   |
| Page, 50 concurrent sessions | p95 2.0 s |
| Throughput                   | ~31 req/s |
| Failures out of 200 requests | 0         |

The 1.6 s median under burst is **not** a per-request latency: it is the queue of
a single process serving fifty requests that arrived together. Server cost per
page stays around 30 ms.

## Before announcing any production release

```bash
npm run typecheck && npm run lint && npm test && npm run test:rls && npm run test:e2e
```

And check:

- [ ] `[auth.mfa.totp]` enabled on the hosted project;
- [ ] `CRON_SECRET` and `BACKUP_ENCRYPTION_KEY` set, and **the encryption key
      stored somewhere other than the backups**;
- [ ] a first successful backup, and a restore drill passed;
- [ ] `/api/health` polled by the host's monitoring.
