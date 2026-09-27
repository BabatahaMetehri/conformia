# Architecture

This document explains **why** the code is laid out this way. The rules themselves
live in [CLAUDE.md](../CLAUDE.md), which is authoritative; what follows motivates
them and states the trade-offs.

## The idea that structures everything

**The database is the authority, not the application.**

This is not a style preference. The platform follows tax and social security
obligations: data read by the wrong person, a state transition granted in error, a
write with no trace are not display bugs — they are breaches. And an
application-level guard is bypassed by any path that does not go through it: a
script, a console, a screen someone forgot to protect, a direct call to PostgREST.

The guarantees therefore live **in the database**:

| Guarantee                      | Where it lives                                      |
| ------------------------------ | --------------------------------------------------- |
| Compartmentalisation by domain | RLS on every table, no exception (96/96)            |
| Permitted state transitions    | `status_transition_rules` + `evaluate_transition()` |
| Preparer/validator separation  | `apply_occurrence_transition()`                     |
| Dossier completeness           | `occurrence_missing_items()`                        |
| Traceability                   | `audit_trigger()`, append-only `audit_log`          |
| Due-date calculation           | ⚠️ exception — in TypeScript, see below             |

The application, for its part, **explains**. It greys out a button, names the
missing document, offers the right action. If it gets it wrong, the user is
poorly guided; they never obtain a right they do not have.

### The accepted exception: due-date calculation

`src/services/scheduling/due-dates.ts` is TypeScript, not SQL. It is the only
business rule outside the database, and the reason is the preview screen: the
referential shows the next six deadlines **while you type**, before anything is
saved. A SQL implementation would require a round trip per keystroke.

The trade-off is explicit: this module is the only one in the project carrying a
**100 %** coverage threshold, branches included, and it is additionally exercised
by property tests (`tests/unit/due-dates.properties.test.ts`). A wrong deadline
produces a late filing, and therefore a real penalty.

## The layers, and what they refuse

```
app/       routing, RSC, layouts
  ↓
features/  business UI — compartmentalised by domain
  ↓
services/  rules, orchestration, Result<T, AppError>
  ↓
data/      Supabase access, one function = one query
  ↓
db/        SQL: tables, RLS, functions, triggers
```

Three prohibitions, held **by ESLint** (`import/no-restricted-paths`) and not by
discipline:

1. **No upward dependency.** `services/` knows nothing of React; `data/` knows
   nothing of the services.
2. **No lateral dependency between features.** `features/documents` imports
   nothing from `features/occurrences`. Sharing goes through the layer below —
   which is why `useDirectUpload` lives in `components/shared` and receives its
   Server Actions **as parameters** rather than importing them.
3. **No component instantiates a Supabase client.** The only authorised module is
   `src/lib/supabase/*`.

Rule 3 has a consequence you discover by breaking it: an attempt to import
`@/data/queries/jobs` from a component in `features/` makes **the build fail**,
not merely the lint. That is intended — a boundary that breaks nothing is not a
boundary.

## `Result<T, AppError>` rather than exceptions

Every service function returns a `Result`. Exceptions are reserved for programming
bugs.

```ts
type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E };
```

What it buys: the caller **cannot forget** the failure case, the compiler makes
them handle it. What it costs: more lines. The trade is settled because a missing
`try/catch` in a generation job stops production of ALL of the night's
occurrences, not just the problematic one.

`AppError` carries a **code** (a literal union) and an **i18n key**, never a
written message: the text belongs to the catalogues, the error to the domain.
`toClientError()` scrubs the details before sending to the browser — file paths,
stacks and causes stay server-side (`src/lib/errors.ts`, covered by a dedicated
test).

## Regulatory rules are DATA

Periodicity, due-date calculation, required documents, thresholds, responsible
entity: in the database. Adding an obligation requires **no deployment**.

```ts
if (obligation.code === "G50") { ... }   // ❌ never, nowhere
```

Concrete consequence: `due_rule` is a `jsonb` column validated by Zod
(`DueRuleSchema`), not a `switch`. A new rule that cannot be expressed with the
model in place extends the **model**, never the code with a special case.

## The middleware: what it protects, and what it does not

`src/middleware.ts` runs before every route. It carries, in this order:

1. the CSP nonce and the security headers;
2. the **correlation id** (`x-request-id`), which flows down to
   `audit_log.request_id`;
3. session refresh;
4. **write rate limiting** (60/minute/user);
5. the gates: deactivated account, IP allowlist for ADMIN, second factor required.

⚠️ **It does not protect the data.** A user who bypassed every one of these
redirects would still see no rows: RLS applies in the database. The middleware
protects the experience and the HTTP surface.

## Rendering: server by default

Server Components everywhere there is no interaction. `"use client"` is justified
case by case — a form, a sortable table, an upload queue. The shared bundle
measures **102 kB** gzipped (budget: 200 kB), measured by `npm run build`.

Two traps encountered, both documented at the point where they bite:

- **A function does not cross the RSC boundary.** Passing a date formatter as a
  prop raises "Functions cannot be passed directly to Client Components". Pass the
  data; the client formats it.
- **`router.refresh()` chained onto a Server Action is cancelled.** See
  `src/hooks/use-query-navigation.ts` and `occurrence-checklist.tsx`: the fix that
  holds does not rest on a delay but on a **factual stop condition** — ask again
  until the page has seen the change.

## Where to find what

| Question                             | File                                               |
| ------------------------------------ | -------------------------------------------------- |
| Who is allowed to do what            | [security.md](./security.md)                       |
| What the database contains           | [data-model.md](./data-model.md)                   |
| Why this choice rather than that one | [decisions.md](./decisions.md)                     |
| What to do when it breaks            | [runbook.md](./runbook.md)                         |
| What the tests guarantee             | [testing.md](./testing.md)                         |
| What the queries cost                | [query-plans.md](./query-plans.md)                 |
| Backups and restore                  | [backup-strategy.md](./backup-strategy.md)         |
| Changing host                        | [hosting-portability.md](./hosting-portability.md) |
| How to install it                    | [deployment.md](./deployment.md)                   |
| The simple, step-by-step version     | [complete-guide.md](./complete-guide.md)           |
