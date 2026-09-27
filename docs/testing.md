# Tests

Four suites. Each guarantees something the others cannot, and **none is
sufficient alone**. This document says which one answers which question — and what
none of them covers.

## What each suite establishes

| Suite                       | Command            | What it establishes                                 |
| --------------------------- | ------------------ | --------------------------------------------------- |
| Unit (Vitest)               | `npm test`         | The PURE modules compute correctly                  |
| Property (fast-check)       | included above     | What must stay true FOR ANY input                   |
| Integration (Vitest + `pg`) | `npm run test:rls` | RLS, triggers and SQL functions genuinely refuse    |
| End-to-end (Playwright)     | `npm run test:e2e` | The screens, chained together, do what they promise |

State at the last count: **711 unit tests**, **418 integration tests**, **141
end-to-end tests** across two engines, none skipped.

## Unit — the pure modules

`tests/unit/`, plus the tests colocated in `src/`.

The coverage report covers **only** the pure modules: `src/lib/`, `src/config/`,
`src/services/scheduling/`, the state machine and the completeness calculation.
Measured: **94.9 % of statements, 88.6 % of branches**.

Per-file thresholds, enforced by `vitest.config.mts`:

| Module                                           | Threshold | Why that level                                                                       |
| ------------------------------------------------ | --------- | ------------------------------------------------------------------------------------ |
| `services/scheduling/due-dates.ts`               | **100 %** | A wrong deadline produces a late filing, therefore a penalty                         |
| `services/workflow/state-machine.ts`             | **100 %** | A badly translated refusal sends the user looking for a document that does not exist |
| `services/occurrences/completeness.ts`           | **100 %** | Decides what the screen declares missing                                             |
| `lib/dates.ts`, `lib/result.ts`, `lib/errors.ts` | 95 %      | Everything else depends on them                                                      |
| `services/scheduling/due-rule.ts`                | 95 %      | Gatekeeper of the referential                                                        |
| All retained modules together                    | 92 / 85   | Stops a pure module arriving untested                                                |

### ⚠️ Why the orchestration services are EXCLUDED

`services/documents/upload.ts`, `services/export/*`, `services/dashboard/*` and
their neighbours show 0 % in that report. That is not an oversight.

These modules have almost no logic of their own: they call a SQL function and
translate its result. Covering them in unit tests would mean **mocking the
Supabase client** — the test would then measure the mock, and would go green on
the day the real policy changed. The rule lives in RLS and in the SQL functions;
it is therefore exercised against a real database.

What these modules guarantee is verified by the other two suites. The unit
coverage figure does not describe their quality, it describes the nature of the
code.

## Property — what must stay true for ANY input

`tests/unit/due-dates.properties.test.ts`, with fast-check.

Example-based tests exercise the cases you thought of. Calendar defects live
exactly where you did not: a 31st in a 30-day month, a 29 February shifted by a
year, a holiday next to the **Algerian** weekend — Friday–Saturday. Here the
machine hunts for the counter-example across thousands of combinations and shrinks
it to the smallest reproducible case.

Properties held:

- the calculation never throws — every refusal goes through a `Result`;
- the legal deadline falls on neither a weekend nor a holiday when the rule forbids
  it;
- the shift goes in the declared direction, never the other;
- `shiftReason` is set **exactly** when the date moved;
- the internal deadline is never later than the legal one;
- the calculation is deterministic;
- `addBusinessDays` never lands on a non-working day, and going forward then back
  by the same amount returns to the same working day.

⚠️ **One property written first was wrong.** "`resolveLeadDays` always returns a
strictly positive margin": fast-check shrank it in twenty-eight draws to the
counter-example `["LOW", 0]`. A low criticality's margin is zero **by decision**.
The test was wrong, not the code — and that is exactly the service this suite
provides.

## Integration — does the database really refuse?

`tests/integration/`, against the local database, under a user session
(`set local role authenticated` + JWT claims).

⚠️ **Under a session, never as `postgres`.** A test querying the database as
superuser measures no policy: it measures a database without RLS.

Covers: the RLS matrix role × table × operation, audit and append-only triggers,
occurrence generation, document upload and integrity, the full state machine,
notifications, exports, backups, dashboard.

`rls.test.ts` fails if **a single** table appears without RLS — that is what makes
the promise "96 tables, 96 protected" sustainable.

`authorization-model.test.ts` compares the **whole role → permission matrix**, not
a sample: it is the grant _in excess_ that is dangerous, and only that one escapes
a sampled test. It also verifies **structurally** — over `pg_policies` and
`pg_proc` — that no policy calls an authorisation function without wrapping it, and
that the fifteen authorisation functions stay `STABLE PARALLEL SAFE`.

### Isolation by entity — the rule that makes the suite usable

⚠️ **The suite runs against a database WITH the AGROESPACE referential loaded.**
That is the production state; testing against an empty database exercises a
situation that will never exist.

It was not always so, and the price was heavy: several tests asserted on **global
counts** — `select count(*) from obligation_occurrences` — that is, on the state of
the database rather than on their own behaviour. They passed on an empty database,
failed once the 23 real obligations were loaded, and **having a usable application
and a green suite were two incompatible states**. The only way to reconcile them
was to remove the referential, and therefore to stop exercising anything realistic.

#### The mechanism

`entity_id` has existed on every business table since migration 0001, with a
default pointing at the AGROESPACE entity. The column was meant for future
multi-site compartmentalisation; it gives test isolation **without one extra line
of schema**.

Each file creates its **own entity**, puts everything it builds inside it, and
asserts only on that. Three shapes are allowed, and one idea — _nothing a file
asserts may depend on what it did not produce_:

| Shape                            | When                                          | How                                                        |
| -------------------------------- | --------------------------------------------- | ---------------------------------------------------------- |
| `createTestScope()`              | **every new file**                            | `tests/helpers/test-scope.ts`                              |
| an `ENTITY` constant in the seed | files predating the helper                    | entity created at the top of `SEED`, attachment at the end |
| a reference state                | files whose SUBJECT is the shared referential | record the state BEFORE acting, assert only on the delta   |

#### Writing a new test

```ts
import { createTestScope, destroyTestScope, type TestScope } from "../helpers/test-scope";

let scope: TestScope;
beforeAll(async () => {
  scope = await createTestScope();
}, 120_000);
afterAll(async () => {
  await destroyTestScope(scope);
}, 120_000);

it("…", async () => {
  const supervisor = await scope.createUserWithRole("SUPERVISEUR");
  const obligation = await scope.createObligation({ domain: "FISCAL" });
  const dossier = await scope.createOccurrence({ obligationId: obligation, periodKey: "2026-04" });

  await scope.asUser(supervisor, async (client) => {
    // …under a user session, RLS applied, transaction rolled back at the end.
  });
});
```

The factories cover the whole model: obligation (`ENTITY` or `PER_REGISTER`
scope), commercial register, occurrence, document, profile, role, absence,
delegation. `scope.asRole("SUPERVISEUR")` returns a **genuinely authenticated**
Supabase client — it goes through `signInWithPassword`, so through the real token
and the real PostgREST chain, where a `service_role` client would bypass the
policies.

`createTestScope()` **sweeps up** test entities that an interrupted run left
behind — older than ten minutes, so it never touches a run in progress. Without
that, an `afterAll` that does not complete abandoned its entity, and the only way
to get rid of it was resetting the database — which is what this mechanism exists
to avoid.

#### What is forbidden, and why

`tests/integration/suite-hygiene.test.ts` enforces it **mechanically**, naming the
file and the line. There is deliberately **no exemption list**: a file that cannot
satisfy these rules is a file whose assertions depend on the database's initial
state.

- ❌ **Counting a whole business table.** `select count(*) from
obligation_occurrences` measures how empty the database is, not
  compartmentalisation.
- ❌ **Reading a business table with no filter at all.** It returns what others
  created.
- ❌ **A file that bounds its data to no entity.**

Two things remain **allowed**, for good reasons:

- ✅ **A global count expected to be ZERO.** "this administrator sees no dossier, in
  the entire database" is _stronger_ than a bounded count: it can only become false
  if compartmentalisation gives way — precisely what we want to learn.
- ✅ **REFERENCE tables** — `roles`, `permissions`, `domains`,
  `status_transition_rules`. Their count is a decision, not a state; it is exactly
  what the role matrix checks.

The guard verifies itself: one of its tests feeds it a manufactured violation and
requires it to name it. A guard you have never seen fail is not a guard — an
over-strict regular expression or a path matching no file makes a permanent green
that protects nothing.

#### ⚠️ An ENVIRONMENT defect to know about: "the database system is in recovery mode"

If the suite starts failing in clusters, on different files each run, with the
error **"the database system is in recovery mode"**, the culprit is not the code:
**the local PostgreSQL container is crashing**.

Symptom in the container log:

```
LOG: server process (PID …) was terminated by signal 11: Segmentation fault
DETAIL: Failed process was running: select * from public.exportable_occurrences($1::uuid)
LOG: all server processes terminated; reinitializing
```

The defect was **isolated**: a WITNESS function created for the purpose — a
three-word `select n`, with no execute right for `authenticated` — brings the
server down as soon as it is called under that role. In other words, **any
permission refusal on a function call** can crash this PostgreSQL, whatever the
function contains. No migration in the project is responsible, and several tests
legitimately EXPECT a "permission denied" — they are the designated victims.

The state only appears after the container has been in use for a while; it
survives `supabase db reset`, which recreates the database without restarting the
process.

**Remedy** — restart the stack, not just the database:

```bash
npx supabase stop && npx supabase start
```

To check afterwards that no crash happened during a run:

```bash
docker logs supabase_db_conformia 2>&1 | grep -c "Segmentation fault"
```

Zero is the only acceptable answer. A non-zero result invalidates the ENTIRE run:
the failures it reports are collateral damage, and its successes are worth no
more.

#### Running the suite

```bash
npm run test:integration          # against the database as it stands
npm run test:integration:fresh    # db reset + db:seed + tests — the reference state
npm run test:integration:slow     # the @slow tests only
```

The suite must pass **twice in a row without a reset**: that is the proof each
file cleans up after itself.

### Tests marked `@slow`

A test whose name carries `@slow` builds a realistic volume before measuring:
`dashboard-performance.test.ts` loads **50,000 dossiers** then times the screens.
It is part of `npm run test:rls` and is not separated from it — a performance
budget you do not run is a budget you do not hold.

The marker exists to **select** them when you want only those, or to exclude them
from a tight development loop:

```bash
npx vitest run --config vitest.integration.mts -t "@slow"          # those alone
npx vitest run --config vitest.integration.mts -t "^(?!.*@slow)"   # all the others
```

⚠️ **The budget covers TWO quantities, and the second matters more.** The
validation queue must stay under **200 ms** _and_ under **10,000 buffer hits**.
Time depends on the machine; buffer hits do not. A policy whose call stops being
wrapped in `(select ...)` blows the block count back up long before the stopwatch
notices on a fast machine.

⚠️ The load ends with a `VACUUM ANALYZE`. That is not a comfort: the end-of-file
cleanup leaves 50,000 dead tuples behind, and a second run then measured the bloat
instead of the query cost — 18,535 hits on the second pass against fewer than
10,000 on the first, on identical code.

⚠️ **This test is sensitive to CPU contention.** Observed during this work: it
failed at 18,720 ms against a 10,000 ms budget while a build and two servers were
running in parallel, and passed in 8.5 s on its own. If it fails, run it alone
before believing it.

### Email sending — genuinely sent, genuinely received

`tests/integration/notification-delivery.test.ts` runs `runNotificationJob` and
then **checks the mailbox**. Mailpit — Supabase's local mailbox, UI on `54324`,
SMTP on `54325` — receives real messages and makes them queryable by API.
`tests/helpers/mailpit.ts` wraps that access.

⚠️ **No `vi.mock` of the provider.** A mock verifies that a function was called; it
verifies neither that the message leaves, nor that it carries the right recipient,
nor that the HTML body holds together, nor that the plain text exists. And that is
exactly what breaks. Before this file, `runNotificationJob` was called by no test,
neither provider was ever instantiated and the eleven templates were never rendered
through the path that renders them in production.

#### The two providers, the same scenarios

The file runs its core scenarios **twice**, once per value of
`app_settings.email_provider`:

| Setting  | Path actually travelled                                               |
| -------- | --------------------------------------------------------------------- |
| `smtp`   | `SmtpProvider` → nodemailer → SMTP → Mailpit                          |
| `resend` | `ResendProvider` → `resend` SDK → HTTP → local relay → SMTP → Mailpit |

The relay is `tests/helpers/resend-shim.ts`: an HTTP server implementing
`POST /emails` and handing the message to Mailpit. The SDK finds it on its own,
through the `RESEND_BASE_URL` variable it reads when the client is constructed —
**no line of `resend.ts` or of the factory was modified for the test**. What is
exercised is therefore the interchangeability of production code, not of a variant
written for the occasion.

The relay can also **refuse** an address (422, like Resend for an invalid address)
and **answer wrongly** (200 with no id). That is what makes it possible to exercise
retries, permanent failure and `ResendProvider`'s safety net without mocking
anything on our side.

⚠️ An ESLint rule now forbids importing `resend` or `nodemailer` anywhere other
than `providers/{resend,smtp}.ts`. Without it, the promise "changing provider
touches no other file" rested on discipline alone.

#### What the suite establishes

Volume and recipients matching the audience; **deduplication** — two cycles, one
message, and the test fails if `notifications_rule_dedup_key` is removed; silence
on a dossier filed, archived or marked not applicable; **hourly grouping**; the
standard D+1 / D+3 / D+7 chain and the accelerated `CRITICAL` D+0 / D+2 chain;
**rerouting to the stand-in** of an absent person, mention included, the in-app
staying with the absentee; retries with increasing backoff and an alert to
administrators after exhaustion; fifty recipients including one invalid,
forty-nine served; total provider outage — the in-app notifications survive — then
recovery on the next cycle; dormant channels excluded at source.

#### Coverage

```bash
npm run test:integration:coverage   # thresholds on resend.ts and smtp.ts
npm test -- --coverage              # thresholds on src/emails/**
```

⚠️ **Provider coverage is measured in the integration suite**, not the unit one:
their only interesting behaviour is what they do with a real server. Template
coverage is measured in the unit suite, where `renderEmail` is a pure function.

#### Four filters lost, and what they teach

Rewriting `due_notification_candidates` in 0022 — to add rerouting — started from
the 0014 version and **lost four guarantees**: the recipient's channel preference,
the `deactivated_at` check, the exclusion of profiles with no address, and the
revocation of `execute` from `authenticated`. Only one was covered by a test; it
is the one that reported the regression, as soon as the delivery suite existed.
`0023` restores them, and the first three now have their own scenario.

⚠️ **A SQL function rewritten whole does not say what it stopped doing.** Reading a
hundred-line `create or replace` does not make the missing clause appear. When a
migration rewrites an existing function, comparing its `where` clauses with the
previous version costs two minutes.

## End-to-end — the screens, chained together

`e2e/`, Playwright, against a **production build**.

⚠️ Against the production build, not development mode: accessibility, CSP and
bundle splitting can only be verified on the real rendering.

⚠️ **After any Next.js upgrade, delete `.next` first.** Observed on
`15.5.22 → 15.5.26`: the stale build directory made the server fail to start with
a `webpack-runtime` error that looks exactly like broken application code.

### The eight critical journeys

`e2e/critical-journeys.spec.ts` runs on **Chromium AND Firefox**. That is not
redundancy: the two engines diverge on hydration, date serialisation and the exact
moment one navigation replaces another. A journey that passes on one and breaks on
the other is a real defect — and exactly what the rest of the suite cannot see.

1. An ADMIN enrols their second factor through the interface, then uses it to get
   in.
2. Full cycle: upload, submission, validation, filing with the authority.
3. The preparer cannot validate their own dossier.
4. An HR agent cannot reach a fiscal dossier — **not even by direct URL** — and the
   response is indistinguishable from that of a non-existent id.
5. An ADMIN reaches no occurrence and no document.
6. An amendment is born from an archived dossier, the original stays intact.
7. A document's cycle: upload, replacement, download by **signed** URL.
8. A notification created in the database appears in the centre and on the bell.

### Arabic

`e2e/arabic.spec.ts` — five journeys, on Chromium.

⚠️ **This file found a real defect**: the catalogues were kept key for key, 1,416
against 1,416, and Arabic stayed **unreachable** — the language selector was stuck
on French, and since `requestLocale` was empty the whole application rendered in
French even under `/ar/`. A key comparison would have seen nothing: both files were
perfect.

It therefore checks what no comparison can deduce: the menu really offers both
languages, the choice survives the next navigation (cookie, not local state),
`dir="rtl"` is set, the screens render Arabic, **the layout does not overflow
horizontally**, and you can go back to French.

⚠️ The language change is done **from the keyboard**. That is not a workaround: a
mouse click on a Radix submenu item is intercepted in a driven browser, and the
keyboard gesture additionally exercises the selector's accessibility.

### The screens that were shells

`e2e/completed-screens.spec.ts` — "Mon profil", the Administration index and the
notification rules used to render a placeholder, "this section is not built yet".
The file checks they carry **real data**, not just a title — a page showing its
header and nothing else would pass an existence test while staying empty.

It also carries the regression guard: no reachable screen may render a
placeholder. A placeholder is comfortable to put in and easy to forget; it looks
like a feature and nothing flags it.

### Hardening

`e2e/security.spec.ts`: headers present, a nonce **different on every response**,
**zero CSP violations** on the working screens, a zeroed gauge renders empty, and
the route handlers exercised in all three situations — no session, insufficient
session, correct session.

### Accessibility

`@axe-core/playwright` on every main screen. The violations found were fixed, never
added to an exception list.

## Static tests — what no execution shows

Three checks read the code itself:

| Test                           | What it prevents                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------- |
| `server-action-guards.test.ts` | A Server Action with no permission guard                                         |
| `rls.test.ts`                  | A table with no RLS                                                              |
| `logical-properties.test.ts`   | A **physical** Tailwind class (`ml-`, `pr-`, `text-left`)                        |
| `i18n-keys.test.ts`            | A key that resolves to a group, or a parameterised message called with no values |

The third prepares the Arabic switch: logical properties (`ms-`, `pe-`,
`text-start`) flip by themselves. The debt would stay invisible until the day it
cost a full review of the interface.

⚠️ The fourth was extended after a real incident: a plural message called without
its values does not degrade the label, it **raises `FORMATTING_ERROR` and takes the
whole page down**. The Échéancier became unreachable as soon as one line was past
its legal deadline — precisely when the list was most useful. Three occurrences
were found.

⚠️ Each of these tests carries a list of **waivers with a written reason**, and a
check that fails if a waiver becomes unnecessary. A waiver you forget to remove is
a rule switching itself off.

## What no suite covers

Stated here so nobody discovers it in production:

- **Measured browser rendering** — LCP, INP, CLS. `npm run load-test` measures the
  server (~100 ms per page alone, p95 2.0 s at fifty concurrent sessions, 0 failures
  out of 200 requests); it launches no browser.
- **Restore under real conditions.** `npm run restore:test` restores into a
  disposable database — already far more than nothing, but not a failover exercise.
- **Load beyond fifty sessions.**

## One intermittency explained, one tolerance accepted

### Filters and sorting: the cause eventually showed itself

Three tests failed across runs — `obligations.spec.ts:142`,
`occurrences.spec.ts:225`, `occurrences.spec.ts:210` — always the same way: the URL
did not receive what was asked of it. Long treated as load-related flakiness, it was
a **real defect**, and it affected users.

The recording finally showed it unambiguously: the navigation request leaves, the
router **aborts** it (`net::ERR_ABORTED`), and the React transition carrying it then
**never** completes. `pending` stays true indefinitely; and the controls are
disabled while a navigation is in flight. Measured: search field greyed out and URL
frozen **eight seconds** after typing, with no recovery.

Four shapes were tried, each wrong for its own reason:

| Shape                                 | Why it fails                                                      |
| ------------------------------------- | ----------------------------------------------------------------- |
| Retry at a fixed cadence              | Duplicates itself: each attempt interrupts the previous one       |
| Guarding on `pending` alone           | A lost navigation leaves `pending` stuck → **permanent deadlock** |
| A limit in NUMBER of attempts         | Exhausts its quota in two seconds, when it should persist         |
| The condition read in the effect body | The effect does not re-run: `Date.now()` is not a dependency      |

The shape retained combines all four lessons: a limit in **time** (twenty seconds),
a **doubling** wait, `pending` read by **reference** inside the timer, and rearming
on every beat. Factual stop condition: does the URL carry what we asked for?

Since then, **two consecutive full runs pass**.

⚠️ What remains true: the mechanism compensates for a Next.js behaviour it does not
fix. If a new screen shows the symptom, the cause is there, not in the screen.

### Windows exhausts its ephemeral ports: `net::ERR_NO_BUFFER_SPACE`

⚠️ **This is not an application defect, and it must not be looked for there.**

The symptom: an end-to-end test fails on `page.goto: net::ERR_NO_BUFFER_SPACE`,
often after a hundred or so tests, never twice in the same place. Run alone, the
same test passes.

The cause is systemic. Windows keeps every closed socket in `TIME_WAIT` for four
minutes and opens only a narrow dynamic port range by default. The suite consumes a
lot of them: over a hundred tests, each with its HTTP requests, its session and its
pool of PostgreSQL connections. Beyond a certain rate, the network stack refuses to
open one more.

**What was done**, in `playwright.config.ts`: one **retry** under Windows
(`retries: 1`). A second attempt starts from freed ports; an application failure
fails both times — so the retry masks no real defect.

⚠️ **This retry also absorbs the Firefox intermittency** described below. Two
consecutive full runs now give "141 passed, 1 flaky" where one of the two used to
fail. A test reported **flaky** is not a green test: it signals that it took more
than one go. The report names it, and it has to be read.

⚠️ **What NOT to do: raise the worker count.** The suite already runs on one
(`workers: 1`, `fullyParallel: false`), and it already did when the incident
occurred. Two would double the socket rate — exactly what is short. The setting
carries a comment to that effect, so nobody raises it again believing it saves
time.

If the symptom became frequent, the remedy is systemic and not in the suite: widen
the dynamic range and shorten `TIME_WAIT`
(`netsh int ipv4 set dynamicport tcp start=10000 num=55000`).

### Firefox and interrupted navigations

Firefox reports `NS_BINDING_ABORTED` as soon as one navigation replaces another;
Chromium absorbs the same case silently. The `visit()` helper tolerates that
precise error and **only that one**, because the navigation does complete: what
establishes it is the page obtained, verified by the assertions that follow.

## Before announcing "done"

```bash
npm run typecheck && npm run lint && npm test && npm run test:rls && npm run test:e2e
```

All five pass, or it is not done.
