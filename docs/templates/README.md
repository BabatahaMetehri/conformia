# Import templates

> The app is in French; screen names below are given as they appear.

## `jours-feries.csv`

The public holiday calendar, imported from **Administration → Référentiels**.

Format: `date,label,recurring` — the date as `YYYY-MM-DD`. A header line is
tolerated. The recurring column accepts `true`, `1` or `oui`.

⚠️ **The file itself stays in French** — its labels are written into the database
and shown in a French interface. Only this notice is in English.

### The two kinds of public holiday, and why they do not mix

**The five CIVIL feasts** — 1 January, Yennayer, 1 May, 5 July, 1 November —
return on the same day of the same month. They are marked `true`: entered
**once**, they apply to every year. They are already in the database; they appear
in the template so it is complete, and re-importing them does nothing more than
rewrite them identically.

**The RELIGIOUS feasts** — Aïd el-Fitr, Aïd el-Adha, Awal Moharem, Achoura,
Mawlid Ennabaoui — follow the Hijri calendar and are set **each year by decree**.
They are marked `false`: they belong to one year and one only.

⚠️ **Never mark a religious feast `true`.** It would be projected onto every year
at the same Gregorian date — wrong by construction — and would make the coverage
check believe the year has been entered, switching off the very alert that exists
to report that it has not.

### The religious dates are not provided, and that is deliberate

The religious lines in the template carry `AAAA-MM-JJ` in place of the date. This
is not an oversight: **no formula can compute them**, and a guessed date would be
worse than no date at all — it would produce no visible error, only a wrong
deadline that looks right.

The placeholder is **refused by the import** until it is replaced: the line is
counted as unreadable and shown before anything is written. That is the intended
direction of failure — a rejected line is visible, an invented date is not.

The dates are obtained from the accountants or the Official Journal. The number of
days per feast (one or two) is also set by decree: adjust the lines accordingly
rather than assuming.

### After the import

The screen announces, **before** writing, how many deadlines would move. Only
`TODO` dossiers move — those already started, validated, filed or archived are
never touched. To check the coverage obtained:

```sql
select * from public.holiday_calendar_coverage;
```
