// @vitest-environment node

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { Criticality, DateShift, DueAnchor, Periodicity } from "@/config/constants";
import {
  addBusinessDays,
  buildPeriodKey,
  isBusinessDay,
  toAppTz,
  toUtcFromAppTz,
  WEEKEND_DAYS,
  type PeriodDescriptor,
} from "@/lib/dates";
import {
  computeDueDate,
  computeInternalDueDate,
  resolveLeadDays,
} from "@/services/scheduling/due-dates";
import type { DueRule } from "@/services/scheduling/due-rule";

/**
 * PROPRIÉTÉS du calcul d'échéance — ce qui doit rester vrai POUR TOUTE règle.
 *
 * ⚠️ CE QUE CE FICHIER APPORTE ET QUE LES EXEMPLES N'APPORTENT PAS.
 *
 * Les tests par l'exemple éprouvent les cas auxquels on a pensé. Or les défauts
 * de calendrier vivent exactement là où l'on n'a pas pensé : un 31 dans un mois
 * de 30 jours, un 29 février décalé d'un an, un férié collé au week-end
 * algérien — vendredi-samedi, pas samedi-dimanche. Ici, c'est la MACHINE qui
 * cherche le contre-exemple, sur des milliers de combinaisons, et qui le réduit
 * au plus petit cas reproductible quand elle en trouve un.
 *
 * ⚠️ Une échéance fausse n'est pas un défaut d'affichage : c'est une déclaration
 * déposée en retard, donc une pénalité. C'est le seul calcul du projet à mériter
 * ce niveau de vérification.
 */

const ALGIERS_NOON_HOUR = 12;

/** Instant à midi, heure d'Alger — jamais minuit : le calage de fuseau y bascule. */
function algiersNoon(year: number, month: number, day: number): Date {
  return toUtcFromAppTz(new Date(year, month - 1, day, ALGIERS_NOON_HOUR, 0, 0, 0));
}

function isWeekendInAlgiers(instant: Date): boolean {
  const day: number = toAppTz(instant).getDay();
  return WEEKEND_DAYS.some((weekendDay) => weekendDay === day);
}

function dayKey(instant: Date): string {
  const zoned = toAppTz(instant);
  return `${String(zoned.getFullYear())}-${String(zoned.getMonth() + 1)}-${String(zoned.getDate())}`;
}

// ─── Générateurs ─────────────────────────────────────────────────────────────

/** Une période mensuelle réelle, bornes comprises, entre 2020 et 2035. */
const monthlyPeriod = fc
  .record({ year: fc.integer({ min: 2020, max: 2035 }), month: fc.integer({ min: 1, max: 12 }) })
  .map(({ year, month }): PeriodDescriptor => {
    const start = algiersNoon(year, month, 1);
    const lastDay = new Date(year, month, 0).getDate();
    return {
      key: buildPeriodKey(start, Periodicity.MONTHLY),
      periodicity: Periodicity.MONTHLY,
      start,
      end: algiersNoon(year, month, lastDay),
    };
  });

const shift = fc.constantFrom(
  DateShift.NEXT_BUSINESS_DAY,
  DateShift.PREVIOUS_BUSINESS_DAY,
  DateShift.NONE,
);

/**
 * Règles calées sur la période — les seules qui n'exigent pas de date d'ancrage.
 *
 * ⚠️ `weekend_shift` et `holiday_shift` sont TIRÉS ENSEMBLE : `validateDueRule`
 * refuse deux directives opposées, et générer cette combinaison ne mesurerait
 * qu'une règle que la validation aurait déjà écartée.
 */
const periodRule: fc.Arbitrary<DueRule> = fc
  .record({
    anchor: fc.constantFrom(DueAnchor.PERIOD_END, DueAnchor.PERIOD_START),
    offset_days: fc.integer({ min: -60, max: 120 }),
    offset_months: fc.integer({ min: -2, max: 6 }),
    year_offset: fc.integer({ min: -1, max: 2 }),
    direction: shift,
  })
  .map(({ direction, ...rest }) => ({
    ...rest,
    weekend_shift: direction,
    holiday_shift: direction,
  }));

/**
 * Jours chômés en DATES, pour les aides bas niveau.
 *
 * ⚠️ `addBusinessDays` et `computeInternalDueDate` travaillent sur des dates
 * déjà choisies : ce sont des primitives de calendrier, elles n'ont pas à
 * connaître la récurrence. La projection appartient au moteur d'échéance, qui
 * seul sait sur quelle année l'échéance tombe.
 */
const holidayDates = fc
  .uniqueArray(fc.integer({ min: 1, max: 28 }), { minLength: 0, maxLength: 6 })
  .chain((days) =>
    fc
      .record({
        year: fc.integer({ min: 2020, max: 2036 }),
        month: fc.integer({ min: 1, max: 12 }),
      })
      .map(({ year, month }) => days.map((day) => algiersNoon(year, month, day))),
  );

/** Jours fériés du mois de la période, pour éprouver la collision avec le week-end. */
const holidays = fc
  .uniqueArray(fc.integer({ min: 1, max: 28 }), { minLength: 0, maxLength: 6 })
  .chain((days) =>
    fc
      .record({
        year: fc.integer({ min: 2020, max: 2036 }),
        month: fc.integer({ min: 1, max: 12 }),
      })
      /*
       * ⚠️ DATES EXACTES, jamais récurrentes. Une entrée récurrente se projette
       * sur toutes les années : les propriétés éprouvées ici portent sur UNE
       * période, et un jour chômé surgissant d'une autre année les rendrait
       * fausses pour une raison qui n'a rien à voir avec ce qu'elles affirment.
       */
      .map(({ year, month }) =>
        days.map((day) => ({
          date: [String(year), String(month).padStart(2, "0"), String(day).padStart(2, "0")].join(
            "-",
          ),
          isRecurring: false,
        })),
      ),
  );

// ═════════════════════════════════════════════════════════════════════════════

describe("computeDueDate — propriétés", () => {
  it("ne lève JAMAIS : tout refus passe par un Result", () => {
    /*
     * ⚠️ La garantie structurante du projet (CLAUDE.md §3.3). Une exception
     * échappée d'ici traverserait un job de génération et arrêterait la
     * production de TOUTES les occurrences de la nuit, pas seulement celle qui
     * pose problème.
     */
    fc.assert(
      fc.property(periodRule, monthlyPeriod, holidays, (rule, period, days) => {
        const result = computeDueDate({ rule, period, holidays: days });
        expect(typeof result.ok).toBe("boolean");
      }),
      { numRuns: 500 },
    );
  });

  it("l'échéance légale ne tombe jamais un week-end quand la règle l'interdit", () => {
    fc.assert(
      fc.property(periodRule, monthlyPeriod, holidays, (rule, period, days) => {
        if (rule.weekend_shift === DateShift.NONE) return;
        const result = computeDueDate({ rule, period, holidays: days });
        if (!result.ok) return;
        expect(isWeekendInAlgiers(result.value.legalDueDate)).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it("l'échéance légale ne tombe jamais un jour férié quand la règle l'interdit", () => {
    fc.assert(
      fc.property(periodRule, monthlyPeriod, holidays, (rule, period, days) => {
        if (rule.holiday_shift === DateShift.NONE) return;
        const result = computeDueDate({ rule, period, holidays: days });
        if (!result.ok) return;
        // L'entrée porte déjà la clé du jour : `AAAA-MM-JJ`, la forme comparée.
        const keys = new Set(days.map((entry) => entry.date));
        expect(keys.has(dayKey(result.value.legalDueDate))).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it("le report va dans le sens déclaré, jamais dans l'autre", () => {
    /*
     * ⚠️ Un report qui part du mauvais côté ne se voit pas : la date reste
     * plausible. Elle est simplement fausse — en avance sur une règle qui
     * demandait du recul, ou l'inverse. Sur une échéance fiscale, c'est un
     * dépôt hors délai.
     */
    fc.assert(
      fc.property(periodRule, monthlyPeriod, holidays, (rule, period, days) => {
        const result = computeDueDate({ rule, period, holidays: days });
        if (!result.ok) return;
        const { rawDueDate, legalDueDate } = result.value;

        if (rule.weekend_shift === DateShift.NEXT_BUSINESS_DAY) {
          expect(legalDueDate.getTime()).toBeGreaterThanOrEqual(rawDueDate.getTime());
        } else if (rule.weekend_shift === DateShift.PREVIOUS_BUSINESS_DAY) {
          expect(legalDueDate.getTime()).toBeLessThanOrEqual(rawDueDate.getTime());
        } else {
          expect(legalDueDate.getTime()).toBe(rawDueDate.getTime());
        }
      }),
      { numRuns: 500 },
    );
  });

  it("`shiftReason` est renseigné EXACTEMENT quand la date a bougé", () => {
    // Un motif absent sur une date déplacée rendrait le report invisible à
    // l'écran ; un motif présent sans déplacement en inventerait un.
    fc.assert(
      fc.property(periodRule, monthlyPeriod, holidays, (rule, period, days) => {
        const result = computeDueDate({ rule, period, holidays: days });
        if (!result.ok) return;
        const moved = result.value.rawDueDate.getTime() !== result.value.legalDueDate.getTime();
        expect(result.value.shiftReason !== null).toBe(moved);
      }),
      { numRuns: 500 },
    );
  });

  it("l'échéance interne n'est JAMAIS postérieure à l'échéance légale", () => {
    fc.assert(
      fc.property(
        periodRule,
        monthlyPeriod,
        holidays,
        fc.integer({ min: 0, max: 15 }),
        (rule, period, days, lead) => {
          const result = computeDueDate({
            rule,
            period,
            holidays: days,
            internalLeadDays: lead,
          });
          if (!result.ok) return;
          expect(result.value.internalDueDate.getTime()).toBeLessThanOrEqual(
            result.value.legalDueDate.getTime(),
          );
        },
      ),
      { numRuns: 400 },
    );
  });

  it("le calcul est DÉTERMINISTE : deux appels, un seul résultat", () => {
    // Une dépendance cachée à l'horloge se manifesterait ici, et seulement ici.
    fc.assert(
      fc.property(periodRule, monthlyPeriod, holidays, (rule, period, days) => {
        const first = computeDueDate({ rule, period, holidays: days });
        const second = computeDueDate({ rule, period, holidays: days });
        expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      }),
      { numRuns: 300 },
    );
  });

  it("la période rendue est celle demandée, jamais une voisine", () => {
    fc.assert(
      fc.property(periodRule, monthlyPeriod, (rule, period) => {
        const result = computeDueDate({ rule, period });
        if (!result.ok) return;
        expect(result.value.periodKey).toBe(period.key);
        expect(result.value.periodStart.getTime()).toBe(period.start.getTime());
        expect(result.value.periodEnd.getTime()).toBe(period.end.getTime());
      }),
      { numRuns: 300 },
    );
  });
});

describe("computeInternalDueDate — propriétés", () => {
  it("une marge nulle ou négative rend l'échéance légale INCHANGÉE", () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date("2020-01-01"), max: new Date("2035-12-31"), noInvalidDate: true }),
        fc.integer({ min: -5, max: 0 }),
        (legal, lead) => {
          expect(computeInternalDueDate(legal, lead).getTime()).toBe(legal.getTime());
        },
      ),
      { numRuns: 200 },
    );
  });

  it("une marge positive rend toujours un JOUR OUVRÉ", () => {
    /*
     * ⚠️ C'est la raison d'être de la marge : donner de l'avance en jours de
     * TRAVAIL. Une échéance interne tombant un vendredi algérien rendrait
     * l'avance fictive — l'équipe la découvrirait le dimanche suivant.
     */
    fc.assert(
      fc.property(
        fc.date({ min: new Date("2020-01-01"), max: new Date("2035-12-31"), noInvalidDate: true }),
        fc.integer({ min: 1, max: 15 }),
        holidayDates,
        (legal, lead, days) => {
          const internal = computeInternalDueDate(legal, lead, days);
          expect(isBusinessDay(internal, days)).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("addBusinessDays — propriétés", () => {
  it("n'atterrit jamais sur un jour chômé", () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date("2020-01-01"), max: new Date("2035-12-31"), noInvalidDate: true }),
        fc.integer({ min: -20, max: 20 }).filter((n) => n !== 0),
        holidayDates,
        (from, count, days) => {
          expect(isBusinessDay(addBusinessDays(from, count, days), days)).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("avancer puis reculer d'autant ramène au même jour ouvré", () => {
    /*
     * ⚠️ Vraie SEULEMENT au départ d'un jour ouvré. Partir d'un vendredi et
     * revenir n'a aucune raison de rendre ce vendredi : il n'existe pas dans
     * l'échelle des jours ouvrés. Le test le dit plutôt que de l'ignorer.
     */
    fc.assert(
      fc.property(
        fc.date({ min: new Date("2020-01-01"), max: new Date("2035-12-31"), noInvalidDate: true }),
        fc.integer({ min: 1, max: 12 }),
        holidayDates,
        (from, count, days) => {
          if (!isBusinessDay(from, days)) return;
          const forward = addBusinessDays(from, count, days);
          const back = addBusinessDays(forward, -count, days);
          expect(dayKey(back)).toBe(dayKey(from));
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("resolveLeadDays — propriétés", () => {
  it("ne rend JAMAIS une marge négative", () => {
    /*
     * ⚠️ La borne est ZÉRO, pas un. `INTERNAL_LEAD_DAYS_BY_CRITICALITY.LOW`
     * vaut 0 par décision : une obligation peu critique n'a pas d'avance
     * interne, son échéance interne coïncide avec la légale. La propriété
     * écrite d'abord — « toujours strictement positive » — était donc fausse,
     * et fast-check l'a réduite en vingt-huit tirages au contre-exemple
     * ["LOW", 0]. C'est bien le TEST qui avait tort, pas le code.
     *
     * Une marge NÉGATIVE, en revanche, placerait l'échéance interne APRÈS
     * l'échéance légale : l'alerte anticipée arriverait après le retard.
     */
    fc.assert(
      fc.property(
        fc.constantFrom<Criticality>(
          Criticality.LOW,
          Criticality.MEDIUM,
          Criticality.HIGH,
          Criticality.CRITICAL,
        ),
        fc.integer({ min: -5, max: 30 }),
        (criticality, declared) => {
          expect(resolveLeadDays(criticality, declared)).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("les criticités au-dessus de LOW gardent une avance réelle", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Criticality>(Criticality.MEDIUM, Criticality.HIGH, Criticality.CRITICAL),
        fc.integer({ min: -5, max: 0 }),
        (criticality, declared) => {
          expect(resolveLeadDays(criticality, declared)).toBeGreaterThan(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("une marge déclarée positive l'emporte sur le défaut de criticité", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Criticality>(
          Criticality.LOW,
          Criticality.MEDIUM,
          Criticality.HIGH,
          Criticality.CRITICAL,
        ),
        fc.integer({ min: 1, max: 30 }),
        (criticality, declared) => {
          expect(resolveLeadDays(criticality, declared)).toBe(declared);
        },
      ),
      { numRuns: 200 },
    );
  });
});
