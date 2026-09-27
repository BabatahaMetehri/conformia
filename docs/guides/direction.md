# Guide — Direction (senior management)

> Two pages. You see **all the business content**, you give second-level
> validation, you own the referential. You do not open accounts — that is the
> administrator, and it is deliberate.
>
> The app is in French; screen names below are given as they appear.

---

## The dashboard answers one question

> **"Where do we stand, and what is going to cost us?"**

```
┌─────────────────┬─────────────────┬─────────────────┬─────────────────┐
│    EN RETARD    │  À VALIDER      │   CETTE SEMAINE │   CONFORMITÉ    │
│        2        │        4        │        7        │      94 %       │
└─────────────────┴─────────────────┴─────────────────┴─────────────────┘
```

(Overdue · To validate · This week · Compliance rate)

⚠️ **"En retard" is read against the INTERNAL deadline**, not the legal one. A
dossier late here is not yet late with the authority: it has eaten its margin. It
is a warning, not a penalty — and it is exactly the moment when there is still
time.

The compliance rate counts dossiers filed on time out of all dossiers that have
come due. It does not count future dossiers: a rate that rose mechanically with
time would say nothing.

---

## Your part in the circuit

**Second level of validation.** Some obligations require two validations: the
supervisor gives the first, you give the second. Screen **À valider**.

**The fallback when separation of duties blocks.** If the supervisor prepared a
dossier themselves, they cannot validate it. You do — that is by design, not a
workaround.

**Unlocking an archived dossier.** You alone can reopen an archive, to file an
old supporting document for instance. ⚠️ **A written reason is mandatory** and
stays in the history: an archive reopened without a readable reason would lose
what gives the archive its value.

---

## The referential is yours

Screen **Référentiel**. You can add an obligation, correct a deadline, change a
periodicity — without going through the administrator.

That is intended: the referential is **business content**, not technical
configuration. A law changes, a deadline moves; that is a compliance decision,
not an IT operation.

⚠️ **Before saving, look at the next six dates** the screen computes. That is
where a wrong rule shows — and a wrong deadline produces no visible error, only a
reminder at the wrong moment and a penalty at the right one.

After changing a rule, the tool offers to **recompute future dossiers**, telling
you how many are affected. Past dossiers never move.

---

## The question still open, to settle with the accountants

**CASNOS is two obligations**, and the referential currently carries only one
half:

- the **payment** of the contribution, on **30 June** — confirmed, that is the
  line present in the referential;
- a prior **declaration**, end of January or end of February depending on the
  source — ⚠️ **date not confirmed, obligation deliberately not created**.

Creating it with a guessed date would be worse than its absence: a wrong deadline
produces no visible error, only a reminder at the wrong moment — and the team
would learn to rely on it. As soon as the date is confirmed: **Référentiel →
Nouvelle obligation**, three minutes.

_(CNAS-DAS is corrected: 31 January, not 31 March as originally recorded.)_

## What you do not see, and why

**Utilisateurs** and **Rôles** are not in your menu. Business authority does not
grant itself its own permissions: that is the counterpart to the administrator
seeing no dossiers at all.

You do, on the other hand, have the **Journal d'audit**: who did what, when, on
which dossier, with the state before and after. Nothing in it can be changed or
erased, by anyone — including the administrator.

---

## The three questions that keep coming up

**"Why can the administrator not see the dossiers?"**
So that the person who installs the software is not the best-informed person in
the company. Detail in `pourquoi-admin-ne-voit-pas.md`.

**"A dossier is overdue but the declaration was filed."**
The filing was not recorded in the tool. That is the one case where the indicator
lies — and it lies because nobody told it.

**"Can I export for the statutory auditor?"**
Yes: screen **Rapports**. Tracking table, compliance rate, or a complete archive
of a dossier with its documents and a fingerprint manifest.
