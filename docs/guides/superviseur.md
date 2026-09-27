# Guide — Superviseur (supervisor)

> Two pages. Your job: **check and validate** what the owner prepared. You can
> also prepare when needed — but you will then be unable to validate that
> particular dossier, and that is intended.
>
> The app is in French; screen names below are given as they appear.

---

## Your screen is "À valider" (to validate)

```
┌────────────────────────────────────────────────────────────────────┐
│  À valider                                                   (4)   │
├────────────────────────────────────────────────────────────────────┤
│  ☐  G50 — janvier 2026        A. Cherif   3/3 pièces   HAUTE   ▾  │
│  ☐  CNAS-DTS — T4 2025        A. Cherif   2/2 pièces   MOYENNE ▾  │
│  ☑  ATT-FISC — 2026           K. Belhadj  1/1 pièce    BASSE   ▾  │
│                                                                    │
│  [ Valider la sélection (1) ]                                     │
└────────────────────────────────────────────────────────────────────┘
```

The `▾` arrow expands the dossier **without leaving the queue**: completeness,
documents, recent steps. You decide without opening six tabs.

⚠️ **Checkboxes only appear on low criticalities.** A `HAUTE` or `CRITIQUE`
dossier is validated one at a time, after looking at it. Bulk validation exists
for routine dossiers, not to go fast on what matters.

---

## Validate, reject

**Validate** — the dossier moves to the next step.

**Reject** — ⚠️ **a reason is mandatory**, and it goes to the owner. Write what is
missing, not "non-compliant": the reason is what avoids a second round trip. "The
VAT amount does not match the ledger" can be corrected; "needs review" cannot.

**Some dossiers need two validations.** After yours, the screen says "1
validation of 2" and the dossier **stays** pending: Direction gives the second.
That is not a failure of your action.

---

## ⚠️ Why you cannot validate certain dossiers

If you **prepared** a dossier — or if you are its owner or stand-in — you cannot
validate it. The button is absent, and the screen says so.

It is not your role that is in question, it is **your act**. The check is on what
you did to this particular dossier, not on your position in the org chart. In
that case Direction validates.

This is the strongest guarantee in the system: it makes it impossible for one
person to both prepare and approve a declaration.

---

## Assigning a dossier

The **Affectation** tab of a dossier, or a bulk action from the Échéancier.

Three roles to set:

| Role            | Who that is                                 |
| --------------- | ------------------------------------------- |
| **Responsable** | the one who prepares                        |
| **Suppléant**   | the stand-in — **same rights, permanently** |
| **Superviseur** | the one who will validate                   |

⚠️ **A dossier with no stand-in works fine**, until the day the owner is away and
nobody picks it up. The screen tells you without blocking you.

You can also set a **default** assignment on an obligation, in the referential:
it will apply to future dossiers, and the screen will offer to propagate it to
current ones — telling you how many are affected.

---

## Delegating while you are away

Screen **Administration → Délégations**.

You delegate **your** validation power to someone who will exercise it for a
bounded period. You need nobody's help for this: whoever can validate can
delegate.

⚠️ **You can only delegate for yourself.** Even an administrator cannot create a
delegation on your behalf — they could only revoke one. Consent is not
delegable.

---

## The three questions that keep coming up

**"The dossier disappeared from my queue after I validated it."**
That is the expected behaviour: the queue only shows what is waiting for **your**
decision. The dossier is in the Échéancier, in its new state.

**"I see '1 of 2' and nothing is moving."**
The dossier requires two validations. The second one belongs to Direction.

**"Someone changed the dossier while I was looking at it."**
The screen tells you and refreshes. Read it again before deciding: the version
you had in front of you is no longer the one that counts.
