# Security

The documents tracked here are tax returns, social security data and
correspondence with the authorities. The order of priority is settled and **not
negotiable** (CLAUDE.md §1): confidentiality, then traceability, then integrity,
then convenience — never the reverse.

> The app is in French; role and screen names below are given as they appear.

## Access model

### Three dimensions, not one

Access is granted when all three meet:

1. **The role** carries the permission (`role_permissions`).
2. **The domain** is reachable (`user_roles.domain_id`; `NULL` = all domains).
3. **The row** passes its table's RLS policy.

Any one of the three refusing is enough. That is what makes a display bug
harmless: a button rendered by mistake opens nothing.

### Role → permission matrix

> Settled by migration **0019**, where it is written **once**, as `VALUES`. The
> database is reconciled to it: anything not in the matrix is **removed**, and the
> migration fails if the result differs from what is declared.
> `tests/integration/authorization-model.test.ts` compares it **in full** — not by
> sampling, because it is the grant _in excess_ that is dangerous, and only that
> one escapes a sampled test.

`✓` granted · `—` refused · `ᶠ` limited to the FISCAL domain

| Permission            | ADMIN | DIRECTION | RESPONSABLE | SUPPLEANT | SUPERVISEUR | AUDITOR | EXTERNAL |
| --------------------- | :---: | :-------: | :---------: | :-------: | :---------: | :-----: | :------: |
| `obligation.read`     |   ✓   |     ✓     |      ✓      |     ✓     |      ✓      |    ✓    |    ✓ᶠ    |
| `referential.manage`  |   ✓   |     ✓     |      —      |     —     |      —      |    —    |    —     |
| `register.manage`     |   ✓   |     ✓     |      —      |     —     |      —      |    —    |    —     |
| `occurrence.read`     |   —   |     ✓     |      ✓      |     ✓     |      ✓      |    ✓    |    ✓ᶠ    |
| `occurrence.write`    |   —   |     —     |      ✓      |     ✓     |      ✓      |    —    |    —     |
| `occurrence.assign`   |   —   |     ✓     |      —      |     —     |      ✓      |    —    |    —     |
| `occurrence.submit`   |   —   |     —     |      ✓      |     ✓     |      ✓      |    —    |    —     |
| `occurrence.validate` |   —   |     ✓     |      —      |     —     |      ✓      |    —    |    —     |
| `occurrence.mark_na`  |   —   |     ✓     |      —      |     —     |      ✓      |    —    |    —     |
| `occurrence.unlock`   |   —   |     ✓     |      —      |     —     |      —      |    —    |    —     |
| `document.read`       |   —   |     ✓     |      ✓      |     ✓     |      ✓      |    ✓    |    ✓ᶠ    |
| `document.upload`     |   —   |     —     |      ✓      |     ✓     |      ✓      |    —    |    ✓ᶠ    |
| `document.delete`     |   —   |     ✓     |      —      |     —     |      ✓      |    —    |    —     |
| `absence.manage`      |   ✓   |     ✓     |      —      |     —     |      ✓      |    —    |    —     |
| `audit.read`          |   ✓   |     ✓     |      —      |     —     |      —      |    ✓    |    —     |
| `user.manage`         |   ✓   |     —     |      —      |     —     |      —      |    —    |    —     |
| `role.manage`         |   ✓   |     —     |      —      |     —     |      —      |    —    |    —     |
| `settings.manage`     |   ✓   |     —     |      —      |     —     |      —      |    —    |    —     |
| `dashboard.view_all`  |   —   |     ✓     |      ✓      |     ✓     |      ✓      |    ✓    |    —     |
| `export.generate`     |   —   |     ✓     |      ✓      |     ✓     |      ✓      |    ✓    |    —     |

**Scope.** RESPONSABLE, SUPPLEANT, SUPERVISEUR and DIRECTION are **global**: one
person follows every dossier, across all domains and all registers. The mechanism
is per grant (`user_roles.domain_id is null`), and none of those four roles
carries a default domain. A grant restricted to one domain remains possible
nonetheless — it is through such a grant that the RLS suite _demonstrates_
compartmentalisation, and forbidding it would have removed the means of proving
it.

**The five per-department roles** — `COMPTA_MANAGER`, `COMPTA_AGENT`,
`RH_MANAGER`, `RH_AGENT`, `REGLEMENTAIRE` — are **deactivated** since 0018, not
deleted: `user_roles` and `audit_log` carry their ids, and the history must stay
readable. An inactive role can no longer be granted; it remains readable.

#### Four decisions not to "fix"

- **`register.manage` is distinct from `referential.manage`.** The referential
  describes obligations, the registers describe the company. Striking a register
  **extinguishes generation** of every dossier depending on it — that is not the
  same power as correcting an obligation's label.
- **SUPERVISEUR holds `occurrence.write`.** They can therefore prepare when
  needed, and separation of duties will then stop them validating **that
  dossier** — DIRECTION will. The check is on the **act**, not on the role.
- **DIRECTION has neither `user.manage` nor `role.manage`.** Business authority
  does not grant itself its own permissions.
- **RESPONSABLE and SUPPLEANT are strictly identical.** What separates them is the
  **trace** (`occurrence_transitions.acted_as`), not the right. Declaring an
  absence grants and removes **no** right: `is_absent_on()` is called by no policy,
  and a test verifies that structurally.

### Separation of duties: the check is on the act

Since 0019, validation is refused to anyone who **prepared** the dossier. Three
facts establish it, and the role held is not one of them:

1. the person is its **owner** (`owner_id`);
2. the person is its **stand-in** (`deputy_id`);
3. the person **acted as such** — a transition carrying `acted_as` of
   `RESPONSABLE` or `SUPPLEANT`. Changing function does not erase what you
   prepared.

Two escape valves, unchanged: `app_settings.allow_self_validation` for the general
exception, `obligation_types.allow_self_validation` for a per-obligation waiver.

The rule lives in `self_validation_blocked()`, enforced by the trigger
`trg_occurrences_25_separation_of_duties` — **that is what guarantees it**. The
validation queue and the action bar merely refrain from offering what it will
refuse.

### What Direction administers — and why

DIRECTION holds `referential.manage` and `register.manage`. This is not a grant of
convenience, and it must not be "fixed" by handing it back to the administrator.

**The obligations referential is business content, not technical configuration.**
Adding an obligation because a law changed, correcting a legal deadline, attaching
a legal basis: these are compliance decisions. Reserving them to the technical
administrator would amount to asking the person who manages accounts to settle a
regulatory question they are not placed to settle — and, in practice, to Direction
dictating the entry to them. The delay created adds no control: it moves the
decision without verifying it.

What Direction does **not** have, and what draws the line: `user.manage`,
`role.manage`, `settings.manage`. Business authority does not grant itself its own
permissions.

**Symmetrically, ADMIN sees the Référentiel and the Registres without seeing any
dossier.** They hold `obligation.read`, `referential.manage` and
`register.manage`, but neither `occurrence.read` nor `document.read`: their menu
therefore offers "Référentiel" and "Registres", never "Échéancier", "Documents",
"À valider" or "Tableau de bord". The distinction fits in one sentence — they
administer **what describes** the obligations, they do not read **what fills them
in**.

Both properties are encoded, role by role, in
`tests/integration/navigation-roles.test.ts`. That file is the **reference**: its
lists are exhaustive, read from the matrix in the database, and a permission
change makes it fail there.

### Who can delegate

A delegation says "**I** delegate **my** validation power while I am away". The
gate is therefore `occurrence.validate` — not `role.manage`.

The validation module's original brief put it under `role.manage`, i.e. reserved
to the administrator. That was a mistake, and it corrected itself in use: the
mechanism exists so a dossier does not stall during leave, and imposing an
administrative delay on it produces the well-known workaround — lending your
password. Exactly what delegation was meant to replace.

**The scope is narrower than the gate.** The `validation_delegations_insert`
policy requires `delegator_id = current_profile_id()` and opens **no exception** —
neither `user.manage` nor `absence.manage`:

| Act                     | Who                                   |
| ----------------------- | ------------------------------------- |
| **Create** a delegation | The delegator, and only them          |
| **Read** a delegation   | Delegator, delegate, or `user.manage` |
| **Revoke** a delegation | Delegator, or `user.manage`           |

⚠️ **An administrator does not consent on someone else's behalf.** They can undo a
delegation — revoking is a safety measure — never create one. Arranging a third
party's authority without their act would be precisely what this mechanism exists
to prevent, and the audit trail would then name the delegator for an act they did
not perform.

Four scenarios exercise this in `tests/integration/navigation-roles.test.ts`: the
gate checked across all seven roles, a SUPERVISEUR creating their own delegation,
the same one refused for someone else, and an ADMIN refused the same way.

### ⚠️ Why ADMIN has NEITHER `occurrence.read` NOR `document.read`

This is the most counter-intuitive decision in the model, and the most important.

A technical administrator manages accounts, roles, settings and a referential.
They have **no business reason** to read a VAT return or a payslip. Granting those
permissions "because they are the administrator" would make the person who
installs the software the best-informed person in the company.

The three usual objections, and their answers:

- **"They need it to troubleshoot."** No: an incident is diagnosed with
  `audit_log` — who did what, when, on which entity — and with the correlation id.
  The CONTENT of the dossier helps not at all in understanding why a transition was
  refused.
- **"They can read the database anyway."** With direct server access, yes — and
  that is exactly why such access is an exceptional, traced procedure, and not the
  daily operation of an application account. The difference between "it would be
  technically possible" and "it is granted by default" is the whole difference in
  an incident.
- **"It complicates support."** A little. That is the price, it is low, and it is
  accepted: Direction and the auditor do have the read access that belongs to them.

This compartmentalisation is **tested**, not merely written:
`e2e/critical-journeys.spec.ts` — journey 5 — checks that a signed-in ADMIN reaches
no occurrence, neither through the list, nor by direct URL, nor through the
download route.

## Row Level Security

**96 tables, 96 with RLS enabled.** No exception, verified by
`tests/integration/rls.test.ts` — which fails if a table appears without a policy.
The count includes the `audit_log` partitions; it grows with the schema, and the
property is what matters, not the number.

Two principles hold the whole:

- **A forbidden row is indistinguishable from an absent one.** RLS returns nothing,
  and the interface renders the same "Page not found" screen for a dossier outside
  your domain and for an invented id. Distinguishing the two would allow
  enumerating other domains' dossiers by the difference in message alone. Verified
  by journey 4, which compares the two answers.
- **No `USING (true)` policy.** A table needing no restriction — `permissions`,
  `roles` — carries an explicit read policy, never an open door.

⚠️ **One known, measured limitation.** `obligation_occurrences_select` calls
`security definer` functions that PostgreSQL does not inline. An attempt to factor
them out took one counter from **92 ms to over 30 s**. The bodies are therefore
duplicated deliberately, and a parity test stops them diverging. See
[decisions.md](./decisions.md).

## Documents

- **Private bucket** (`compliance-documents`). No public URL exists.
- **300-second signed URLs**, issued by `/api/documents/[id]/download` after
  authentication, permission check AND access to the occurrence.
- **Logging precedes issuance**, in the same transaction: if the trace cannot be
  written, no URL is delivered. An invisible read is worth less than a refused one.
- **The storage path never leaves**: not in the response, not in a header.
- **SHA-256 fingerprint on upload**, versioning, never overwriting in place.
- **Banned extensions**: including `svg`, `html`, `htm` — an SVG is an XML document
  that can carry a `<script>` and would execute with our cookies.

## Authentication

- **Password**: 12 characters minimum, **no** composition requirement, no forced
  renewal. Periodic expiry produces predictable variants where only the last
  character changes. Checking against breached-password databases is handled by
  Supabase.
- **TOTP second factor REQUIRED** for `ADMIN` and `DIRECTION`
  (`mfa_required_for()`), and generalisable through the `require_mfa_all_users`
  setting.
  ⚠️ **`[auth.mfa.totp]` must be enabled on the Supabase side.** Left at `false`,
  GoTrue refuses every enrolment and **every administrator account is permanently
  locked out of the application**. Observed on the local stack; the setting is now
  present in `supabase/config.toml` with its warning.
- **Attempt throttling**: `is_auth_throttled()` counts failures by email address
  AND by IP over 15 minutes. A block is traced as a failure — a stopped burst is
  exactly what an auditor must be able to find.
- **Identical response** for an unknown address and a wrong password: otherwise the
  form becomes an account enumerator.
- **IP allowlist** applicable to the `ADMIN` role alone.

## HTTP headers

Set by the middleware on **every** response, verified by `e2e/security.spec.ts`:

| Header                      | Value                                                      |
| --------------------------- | ---------------------------------------------------------- |
| `Content-Security-Policy`   | `script-src` with a per-request nonce + `'strict-dynamic'` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload`             |
| `X-Frame-Options`           | `DENY`                                                     |
| `X-Content-Type-Options`    | `nosniff`                                                  |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`                          |
| `Permissions-Policy`        | camera, mic, geolocation, payment, USB: all refused        |

### ⚠️ `style-src 'unsafe-inline'` — a measured decision

`script-src` stays strict: nonce regenerated on every response (verified by a
test), `'strict-dynamic'`, **no** `'unsafe-inline'`.

`style-src`, on the other hand, allows `'unsafe-inline'`. With a nonce, the policy
blocks server-rendered `style="…"` **attributes** — a nonce does not attach to an
attribute, and React serialises `style={{…}}` exactly that way. Measured on a
dossier at "0 of 2": `transform: translateX(-100%)` refused, computed value fell
back to `none`, **completeness bar shown full**. Every gauge in the application was
announcing "complete" regardless of reality.

What the tolerance costs: a CSS injection becomes possible _if_ an injection flaw
exists elsewhere. It executes no script. What the refusal cost: false information,
on a compliance tool, at the exact place where it matters. A test
(`e2e/security.spec.ts`) now records **zero CSP violations** on the working
screens and checks that a zeroed gauge renders empty.

## Write rate limiting

Applied in the middleware, on the `next-action` header: **every** Server Action
passes through it, all sixty-one, without any of them being modified — and above
all without any being forgotten.

- **60 writes per minute per user.** Calibrated on human use: the densest screen
  rarely exceeds a dozen.
- **The counter lives in the database** (`rate_limit_hits` +
  `consume_rate_limit()`). An in-memory counter resets at every deployment and
  ignores other instances: it limits nothing while giving the impression of the
  opposite.
- **Reads are not counted.**
- ⚠️ **Nor are anonymous writes, deliberately.** With no session the only subject
  is the IP address — and a whole office shares one. Measured: a per-IP limit
  refused half the sign-ins of the end-to-end suite, which connects from a single
  address. In production, that is the team blocked at nine in the morning. Sign-in
  — the only write reachable without a session — keeps its own protection, by email
  AND by IP.
- **Fails open**: if the database does not answer, the write goes through. Rate
  limiting protects against excess, not intrusion; making it fail closed would turn
  a database incident into total unavailability.

## Idle expiry

Thirty minutes without a request and the session closes: redirect to sign-in, with
the original path kept so you return to it afterwards.

- The marker is an `httpOnly` cookie carrying **only a timestamp**, rewritten on
  every request. No page script can extend a session.
- Any navigation counts as activity, including link prefetching — which only
  happens in a tab open in front of someone.

⚠️ **WHAT THIS MEASURE PROTECTS, AND WHAT IT DOES NOT.** It closes an abandoned
workstation in a shared office — the real risk for this platform. It does **not**
stop cookie theft: whoever holds the session cookie also holds this one and can
rewrite it. Claiming otherwise would be telling ourselves a story; it is the
Supabase token lifetime and revocation that answer that risk.

Thirty minutes is an accepted compromise. Shorter and the tool becomes hostile:
preparing a dossier means reading documents off-screen, phoning an authority,
looking for a receipt. Longer and an abandoned workstation stays open until the
next day.

## The `service_role` key

Three barriers, from most to least reliable:

1. `import "server-only"` — breaks the build if the module reaches a client bundle.
2. ESLint `no-restricted-imports` — forbids importing it outside `src/server/jobs/`.
3. Runtime guard — a `_job-context` marker set by each job.

Authorised uses, a **closed** list: scheduled generation, notifications, retention
purge, backups, integrity checking, health probe. Routes that need it go through a
**dynamic import** of the job, which keeps the module out of their static graph —
`/api/cron/generate` and `/api/health` follow that arrangement.

## Anonymous access — probed, not assumed

Verified with the public key alone, with no session (see migration 0027):

| Probe                                                                                       | Answer                         |
| ------------------------------------------------------------------------------------------- | ------------------------------ |
| `GET /rest/v1/profiles`, `obligation_occurrences`, `documents`, `app_settings`, `audit_log` | `200` with **zero rows**       |
| `GET /rest/v1/cron_dispatch_config`                                                         | `401` — no grant at all        |
| `POST /rpc/deactivate_user`, `/rpc/reset_user_mfa`                                          | `401` — "user.manage required" |
| `POST /rpc/health_snapshot`                                                                 | `401` since 0027               |

⚠️ **`health_snapshot` used to answer `200`.** It returned backup status, document
counts and failed job counts to anyone — that is, when a destruction would hurt
most. The code comment already claimed it was "reserved to the service role"; the
grant had never followed. Closed by 0027, which also revoked `TRUNCATE` from `anon`
and `authenticated` on every table: `TRUNCATE` **is not filtered by RLS**.

## What remains open

- **Five advisories reported by `npm audit`** — two `high`, three `moderate`. None
  has a fix applicable without a major version:

  | Package           | Severity | Reachable here?                                                             | Proposed fix               |
  | ----------------- | -------- | --------------------------------------------------------------------------- | -------------------------- |
  | `postcss`         | high     | No — it only processes our own stylesheets, at build time, no remote source | `next@16` (major)          |
  | `sharp` (libvips) | high     | No — a `next/image` dependency, used nowhere, no remote input               | `next@16` (major)          |
  | `next`            | moderate | Aggregate of the two above                                                  | `next@16` (major)          |
  | `uuid` (v3/v5/v6) | moderate | No — transitive through `exceljs`, reached only when passing a buffer       | `exceljs@3` (a downgrade!) |
  | `exceljs`         | moderate | Same                                                                        | `exceljs@3` (a downgrade!) |

  ⚠️ The fix npm proposes for `exceljs` is an **earlier** version than the one
  installed: npm is offering to go backwards, not forwards. To be revisited when a
  real fix ships. Moving to `next@16` belongs in a dedicated maintenance window —
  see [decisions.md](./decisions.md) §10.

  ⚠️ **A CRITICAL advisory was closed on 2026-09-27.** `next` carried one, and the
  documentation here still claimed only `next@16` could fix it. A patch release was
  available — `15.5.22 → 15.5.26` — and has been applied, along with
  `vitest`/`@vitest/coverage-v8` `4.1.10 → 4.1.11` and a `js-yaml` transitive fix.
  Nine advisories became five, and the critical one is gone. **The lesson is about
  the document, not the package**: a security note that states "no fix exists" ages
  into a reason not to look.

- **`gitleaks` is wired into CI** (`.github/workflows/ci.yml`, job "Secrets —
  gitleaks", with `.gitleaks.toml`), running over the full history. It is no longer
  a manual check.
- **The second factor is required only of `ADMIN` and `DIRECTION`.** The
  `require_mfa_all_users` setting generalises it without development; the decision
  belongs to Direction.
