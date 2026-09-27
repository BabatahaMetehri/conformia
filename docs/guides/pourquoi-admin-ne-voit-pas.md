# "Why can't the administrator see the documents?"

This question will be asked. It will look like a defect. It is not — it is the
most important decision in the access model, and it defends itself very well
provided you have prepared the answer.

⚠️ **Read this before the first training session.** An improvised answer is always
less convincing than a prepared one.

> The app is in French; role and screen names below are given as they appear.

---

## The short answer, to give as it stands

> The administrator manages **accounts**, **roles** and **settings**. They do not
> read the company's tax returns, nor payslips, nor correspondence with the
> authorities. This is not an oversight: it is deliberate, and it is verified at
> every release.

Then, if asked why:

> Because otherwise the person who installs the software would be the
> best-informed person in the company.

That sentence is almost always enough. It moves the question from "this is
inconvenient" to "this is a protection", and nobody argues the other way once it
is said out loud.

---

## What each role actually sees

|                             | Dossiers | Documents | Referential | Accounts |
| --------------------------- | :------: | :-------: | :---------: | :------: |
| **Administrateur**          |    —     |     —     |      ✓      |    ✓     |
| **Direction**               |    ✓     |     ✓     |      ✓      |    —     |
| **Responsable / Suppléant** |    ✓     |     ✓     |  read-only  |    —     |
| **Superviseur**             |    ✓     |     ✓     |  read-only  |    —     |

The administrator sees the **Référentiel** and the **Registres**: those are the
objects that **describe** the obligations. They do not see what **fills them in**.
The distinction fits in one sentence, and it is the one to remember.

Symmetrically, Direction administers the referential but opens no accounts:
business authority does not grant itself its own permissions.

---

## The three objections, and their answers

**"I need it to troubleshoot."**

No. An incident is diagnosed with the **audit log** — who did what, when, on
which entity, with which correlation id — to which the administrator has full
access. The contents of a dossier help not at all in understanding why a
transition was refused. In practice, no incident in this project has required
reading a document.

**"I can read the database anyway."**

With direct server access, yes — and that is precisely why such access is an
**exceptional and traced** procedure, not the daily operation of an application
account. The difference between "it would be technically possible" and "it is
granted by default" is the whole difference on the day you have to explain who
saw what.

**"It complicates support."**

A little, and that is the price. It is low: Direction and the auditor have the
read access that belongs to them, and the audit log answers support questions.

---

## What to do if the need is real

If you **also** need to consult dossiers, the answer is not to widen `ADMIN`: it
is to **hold both roles** on your account.

Administration → Utilisateurs → your account → add `SUPERVISEUR` or `DIRECTION`.

Permissions add up, and the audit log keeps distinguishing **under which role**
each action was taken. You keep both hats, and the history says which one you
were wearing.

⚠️ **What not to do:** add `occurrence.read` to the `ADMIN` role. That would not
touch one account but **the role**, therefore every administrator present and
future, and would break the separation for everyone — silently.
