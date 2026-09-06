import { describe, expect, it } from "vitest";

import {
  Criticality,
  DateShift,
  DueAnchor,
  INTERNAL_LEAD_DAYS_BY_CRITICALITY,
  Periodicity,
} from "@/config/constants";
import { toAppTz, toUtcFromAppTz, type PeriodDescriptor } from "@/lib/dates";
import {
  computeDueDate,
  computeInternalDueDate,
  computePeriods,
  landsOnBusinessDay,
  previewDueDates,
  resolveLeadDays,
  wasShifted,
} from "@/services/scheduling";
import type { DueRule } from "@/services/scheduling";
import type { HolidayEntry } from "@/lib/holidays";

/**
 * Moteur d'échéance — cas ajoutés au lot « génération automatique ».
 *
 * ⚠️ COMPLÈTE `due-dates.test.ts`, ne le remplace pas. Ce fichier ne couvre que
 * ce que l'autre ne couvrait pas : le découpage en périodes appelé directement,
 * l'ordre d'application des décalages, les années bissextiles, et la marge
 * interne comme fonction publique.
 *
 * ⚠️ Toutes les dates sont construites EN HEURE D'ALGER, à midi. `new Date("…")`
 * donnerait minuit UTC, soit 01 h 00 à Alger : invisible jusqu'au jour où un
 * calcul bascule d'une journée entière.
 */

function alger(year: number, month: number, day: number): Date {
  return toUtcFromAppTz(new Date(year, month - 1, day, 12, 0, 0, 0));
}

/**
 * Un jour chômé à DATE EXACTE, tel que la base le porte.
 *
 * ⚠️ `isRecurring: false` par défaut, et ce n'est pas indifférent : une entrée
 * récurrente se projette sur TOUTES les années, y compris celles qu'un scénario
 * ne regarde pas. Les cas qui éprouvent une année précise emploient donc des
 * dates exactes ; ceux qui éprouvent la récurrence le disent.
 */
function ferie(year: number, month: number, day: number, isRecurring = false): HolidayEntry {
  const date = [String(year), String(month).padStart(2, "0"), String(day).padStart(2, "0")].join(
    "-",
  );
  return { date, isRecurring };
}

function iso(instant: Date): string {
  const zoned = toAppTz(instant);
  return [
    String(zoned.getFullYear()),
    String(zoned.getMonth() + 1).padStart(2, "0"),
    String(zoned.getDate()).padStart(2, "0"),
  ].join("-");
}

const period = (
  key: string,
  start: Date,
  end: Date,
  periodicity: Periodicity,
): PeriodDescriptor => ({ key, start, end, periodicity });

const rule = (over: Partial<DueRule> & Pick<DueRule, "anchor">): DueRule => ({
  weekend_shift: DateShift.NEXT_BUSINESS_DAY,
  holiday_shift: DateShift.NEXT_BUSINESS_DAY,
  ...over,
});

/**
 * Échéance AVANT report.
 *
 * ⚠️ DISTINCTION ESSENTIELLE. L'arithmétique d'ancre et de décalage produit une
 * date BRUTE ; les reports s'appliquent ensuite. Les tester ensemble fait
 * échouer un test d'arithmétique pour une raison de calendrier — et pousse à
 * « corriger » l'attente avec une date fausse. Le cas est concret : le 20 février
 * 2026 est un VENDREDI, donc chômé en Algérie. « mensuel J+20 » donne bien le
 * 20 février en brut, et le 22 en légal.
 */
function raw(input: Parameters<typeof computeDueDate>[0]): string {
  const result = computeDueDate(input);
  if (!result.ok) throw new Error(`calcul refusé : ${JSON.stringify(result.error.details)}`);
  return iso(result.value.rawDueDate);
}

// ═════════════════════════════════════════════════════════════════════════════

describe("découpage en périodes, appelé directement", () => {
  it("découpe un exercice mensuel bord à bord", () => {
    const periods = computePeriods(
      { periodicity: Periodicity.MONTHLY },
      { from: alger(2026, 1, 5), to: alger(2026, 3, 20) },
    );

    expect(periods.map((entry) => entry.key)).toEqual(["2026-01", "2026-02", "2026-03"]);
    // Les bornes se touchent sans se chevaucher : le 31 janvier appartient à
    // janvier, le 1er février à février.
    const [january, february] = periods;
    if (january === undefined || february === undefined) throw new Error("périodes manquantes");
    expect(iso(january.start)).toBe("2026-01-01");
    expect(iso(january.end)).toBe("2026-01-31");
    expect(iso(february.start)).toBe("2026-02-01");
  });

  it("rend un tableau VIDE pour ON_EVENT", () => {
    /*
     * ⚠️ Ces obligations naissent d'un fait — un licenciement, un sinistre — et
     * non du calendrier. Le générateur ne doit RIEN en produire : leur création
     * est manuelle, et en fabriquer d'office remplirait l'échéancier de dossiers
     * sans objet que personne ne pourrait clore.
     */
    expect(
      computePeriods(
        { periodicity: Periodicity.ON_EVENT },
        { from: alger(2026, 1, 1), to: alger(2027, 1, 1) },
      ),
    ).toEqual([]);
  });

  it("lit les dates déclarées pour CUSTOM", () => {
    const periods = computePeriods(
      {
        periodicity: Periodicity.CUSTOM,
        occurrences: [
          { month: 3, day: 20 },
          { month: 6, day: 20 },
          { month: 11, day: 20 },
        ],
      },
      { from: alger(2026, 1, 1), to: alger(2026, 12, 31) },
    );

    expect(periods).toHaveLength(3);
    expect(periods.map((entry) => iso(entry.start))).toEqual([
      "2026-03-20",
      "2026-06-20",
      "2026-11-20",
    ]);
  });

  it("REFUSE un intervalle inversé plutôt que de rendre une liste vide", () => {
    // Une liste vide se confondrait avec « rien à générer » — un défaut qui
    // passerait inaperçu jusqu'à ce que des échéances manquent.
    expect(() =>
      computePeriods(
        { periodicity: Periodicity.MONTHLY },
        { from: alger(2026, 6, 1), to: alger(2026, 1, 1) },
      ),
    ).toThrow();
  });
});

describe("ordre d'application des décalages", () => {
  /*
   * Ordre arrêté, et vérifié ici :
   *   ancre → offset_months → offset_days → year_offset → week-end → férié.
   */
  it("applique les mois AVANT les jours", () => {
    // 31 janvier + 1 mois = 28 février, puis + 5 jours = 5 mars.
    expect(
      raw({
        rule: rule({ anchor: DueAnchor.PERIOD_END, offset_months: 1, offset_days: 5 }),
        period: period("2026-01", alger(2026, 1, 1), alger(2026, 1, 31), Periodicity.MONTHLY),
      }),
    ).toBe("2026-03-05");
  });

  it("applique l'ANNÉE en dernier", () => {
    // 31 janvier + 1 mois = 28 février 2026, puis + 1 an = 28 février 2027.
    expect(
      raw({
        rule: rule({ anchor: DueAnchor.PERIOD_END, offset_months: 1, year_offset: 1 }),
        period: period("2026-01", alger(2026, 1, 1), alger(2026, 1, 31), Periodicity.MONTHLY),
      }),
    ).toBe("2027-02-28");
  });

  it("franchit une fin d'année par offset_months", () => {
    expect(
      raw({
        rule: rule({ anchor: DueAnchor.PERIOD_END, offset_months: 3 }),
        period: period("2026-11", alger(2026, 11, 1), alger(2026, 11, 30), Periodicity.MONTHLY),
      }),
    ).toBe("2027-02-28");
  });

  it("respecte le 29 février d'une année bissextile", () => {
    expect(
      raw({
        rule: rule({ anchor: DueAnchor.PERIOD_END }),
        period: period("2028-02", alger(2028, 2, 1), alger(2028, 2, 29), Periodicity.MONTHLY),
      }),
    ).toBe("2028-02-29");
  });

  it("ramène un 29 février sur une année NON bissextile", () => {
    /*
     * ⚠️ Le cas qui casse une arithmétique naïve. + 1 an depuis le 29 février
     * 2028 n'existe pas en 2029 : la date est ramenée au 28, jamais reportée au
     * 1er mars. C'est aussi la raison pour laquelle `year_offset` s'applique EN
     * DERNIER — appliqué à l'ancre, le calage se serait fait sur la mauvaise année.
     */
    expect(
      raw({
        rule: rule({ anchor: DueAnchor.PERIOD_END, year_offset: 1 }),
        period: period("2028-02", alger(2028, 2, 1), alger(2028, 2, 29), Periodicity.MONTHLY),
      }),
    ).toBe("2029-02-28");
  });

  it("recule d'une année quand year_offset est négatif", () => {
    expect(
      raw({
        rule: rule({ anchor: DueAnchor.PERIOD_END, year_offset: -1 }),
        period: period("2026-06", alger(2026, 6, 1), alger(2026, 6, 30), Periodicity.MONTHLY),
      }),
    ).toBe("2025-06-30");
  });
});

describe("double report", () => {
  it("enchaîne un jour férié PUIS le week-end", () => {
    /*
     * 30 avril 2026 est un jeudi. Férié → vendredi 1er mai, chômé → samedi 2,
     * chômé → dimanche 3. Trois pas, deux causes.
     *
     * ⚠️ Le week-end algérien est VENDREDI-SAMEDI. Un lecteur habitué au
     * calendrier européen lira ce test de travers s'il l'oublie.
     */
    const result = computeDueDate({
      rule: rule({ anchor: DueAnchor.FIXED_DATE, fixed_month: 4, fixed_day: 30 }),
      period: period("2026", alger(2026, 1, 1), alger(2026, 12, 31), Periodicity.ANNUAL),
      holidays: [ferie(2026, 4, 30)],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(iso(result.value.legalDueDate)).toBe("2026-05-03");
    // Le motif retenu est le PREMIER rencontré : c'est lui qui explique le décalage.
    expect(result.value.shiftReason).toBe("HOLIDAY");
  });

  it("REFUSE une règle dont le report ne converge pas", () => {
    // Vingt jours fériés consécutifs : la règle est pathologique. Mieux vaut une
    // erreur explicite qu'une boucle qui immobilise le serveur.
    const holidays = Array.from({ length: 20 }, (_, index) => ferie(2026, 3, 1 + index));
    const result = computeDueDate({
      rule: rule({ anchor: DueAnchor.FIXED_DATE, fixed_month: 3, fixed_day: 1 }),
      period: period("2026", alger(2026, 1, 1), alger(2026, 12, 31), Periodicity.ANNUAL),
      holidays,
    });
    expect(result.ok).toBe(false);
  });
});

describe("échéance interne, comme fonction publique", () => {
  it("recule en jours OUVRÉS, pas calendaires", () => {
    /*
     * ⚠️ Le cœur du mécanisme anti-retard. Depuis le dimanche 3 mai 2026, cinq
     * jours OUVRÉS en arrière : jeu 30, mer 29, mar 28, lun 27, dim 26 —
     * vendredi 1er et samedi 2 sont chômés et ne comptent pas. Un décompte
     * calendaire donnerait le 28 avril, soit deux jours de marge fictive.
     */
    expect(iso(computeInternalDueDate(alger(2026, 5, 3), 5))).toBe("2026-04-26");
  });

  it("saute les jours fériés en plus des week-ends", () => {
    expect(iso(computeInternalDueDate(alger(2026, 5, 3), 2, [alger(2026, 4, 30)]))).toBe(
      "2026-04-28",
    );
  });

  it("rend l'échéance légale quand la marge est nulle ou négative", () => {
    expect(iso(computeInternalDueDate(alger(2026, 5, 3), 0))).toBe("2026-05-03");
    // Une marge négative avancerait l'échéance interne APRÈS la légale : absurde,
    // donc traitée comme nulle.
    expect(iso(computeInternalDueDate(alger(2026, 5, 3), -3))).toBe("2026-05-03");
  });

  it("se compte depuis la date REPORTÉE, jamais depuis la brute", () => {
    const result = computeDueDate({
      rule: rule({ anchor: DueAnchor.PERIOD_END, offset_days: 20 }),
      period: period("2026-01", alger(2026, 1, 1), alger(2026, 1, 31), Periodicity.MONTHLY),
      internalLeadDays: 5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(iso(result.value.rawDueDate)).toBe("2026-02-20");
    expect(iso(result.value.legalDueDate)).toBe("2026-02-22");
    // Compter depuis la brute donnerait une avance fausse de deux jours.
    expect(iso(result.value.internalDueDate)).toBe("2026-02-15");
  });
});

describe("marge par défaut selon la criticité", () => {
  it("ne s'applique QUE si l'obligation n'a rien déclaré", () => {
    /*
     * ⚠️ Les valeurs viennent de `INTERNAL_LEAD_DAYS_BY_CRITICALITY`, pas d'une
     * table locale au moteur : deux tables de marges divergeraient au premier
     * ajustement.
     */
    expect(resolveLeadDays(Criticality.CRITICAL, 0)).toBe(
      INTERNAL_LEAD_DAYS_BY_CRITICALITY.CRITICAL,
    );
    expect(resolveLeadDays(Criticality.HIGH, 0)).toBe(INTERNAL_LEAD_DAYS_BY_CRITICALITY.HIGH);
    expect(resolveLeadDays(Criticality.MEDIUM, 0)).toBe(INTERNAL_LEAD_DAYS_BY_CRITICALITY.MEDIUM);
    expect(resolveLeadDays(Criticality.LOW, 0)).toBe(0);

    // Une valeur explicite l'emporte, même plus faible que le défaut.
    expect(resolveLeadDays(Criticality.CRITICAL, 2)).toBe(2);
  });
});

describe("refus du calcul", () => {
  it("REFUSE une FIXED_DATE sans mois ni jour", () => {
    // Inventer un 1er janvier produirait une échéance plausible et fausse.
    const result = computeDueDate({
      rule: rule({ anchor: DueAnchor.FIXED_DATE }),
      period: period("2026", alger(2026, 1, 1), alger(2026, 12, 31), Periodicity.ANNUAL),
    });
    expect(result.ok).toBe(false);
  });

  it("REFUSE une ancre événementielle sans date d'ancrage", () => {
    for (const anchor of [DueAnchor.EXPIRY_DATE, DueAnchor.EVENT_DATE]) {
      const result = computeDueDate({
        rule: rule({ anchor }),
        period: period("2026", alger(2026, 1, 1), alger(2026, 12, 31), Periodicity.ANNUAL),
      });
      expect(result.ok).toBe(false);
    }
  });

  it("REMONTE l'échec d'une période plutôt que de rendre une liste tronquée", () => {
    /*
     * ⚠️ La règle est VALIDE — elle passe Zod — mais son report ne converge pas
     * sur le calendrier fourni. La prévisualisation doit remonter l'échec, pas
     * rendre les deux premières lignes et taire la troisième : une liste
     * silencieusement incomplète se lit comme un calendrier, et se croit.
     */
    const holidays = Array.from({ length: 20 }, (_, index) => ferie(2026, 3, 1 + index));
    const result = previewDueDates({
      rule: { anchor: DueAnchor.FIXED_DATE, fixed_month: 3, fixed_day: 1 },
      periodicity: Periodicity.ANNUAL,
      from: alger(2026, 1, 1),
      count: 2,
      holidays,
    });
    expect(result.ok).toBe(false);
  });

  it("REFUSE une règle malformée à la prévisualisation", () => {
    const result = previewDueDates({
      rule: { anchor: "INEXISTANT" },
      periodicity: Periodicity.MONTHLY,
    });
    expect(result.ok).toBe(false);
  });
});

describe("prévisualisation des périodicités longues", () => {
  it.each([
    [Periodicity.SEMIANNUAL, 2],
    [Periodicity.BIENNIAL, 2],
    [Periodicity.QUARTERLY, 3],
    [Periodicity.ANNUAL, 2],
  ])("enchaîne les périodes %s", (periodicity, count) => {
    const result = previewDueDates({
      rule: { anchor: DueAnchor.PERIOD_END, offset_days: 20 },
      periodicity,
      from: alger(2026, 1, 15),
      count,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toHaveLength(count);
    // Les échéances se suivent dans l'ordre : une liste désordonnée se lirait
    // comme un calendrier faux.
    const times = result.value.map((entry) => entry.legalDueDate.getTime());
    expect([...times].sort((left, right) => left - right)).toEqual(times);
  });

  it("enchaîne plusieurs années pour une règle CUSTOM", () => {
    const result = previewDueDates({
      rule: {
        anchor: DueAnchor.PERIOD_START,
        offset_days: 0,
        occurrences: [
          { month: 3, day: 20 },
          { month: 11, day: 20 },
        ],
      },
      periodicity: Periodicity.CUSTOM,
      from: alger(2026, 1, 1),
      count: 4,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Deux dates par an : quatre lignes couvrent deux années.
    expect(result.value).toHaveLength(4);
  });
});

describe("utilitaires d'affichage", () => {
  it("wasShifted distingue une date déplacée d'une date intacte", () => {
    const shifted = computeDueDate({
      // 1er mai 2026 est un vendredi, donc chômé.
      rule: rule({ anchor: DueAnchor.FIXED_DATE, fixed_month: 5, fixed_day: 1 }),
      period: period("2026", alger(2026, 1, 1), alger(2026, 12, 31), Periodicity.ANNUAL),
    });
    const intact = computeDueDate({
      // 4 mai 2026 est un lundi.
      rule: rule({ anchor: DueAnchor.FIXED_DATE, fixed_month: 5, fixed_day: 4 }),
      period: period("2026", alger(2026, 1, 1), alger(2026, 12, 31), Periodicity.ANNUAL),
    });
    expect(shifted.ok && intact.ok).toBe(true);
    if (!shifted.ok || !intact.ok) return;

    expect(wasShifted(shifted.value)).toBe(true);
    expect(wasShifted(intact.value)).toBe(false);
  });

  it("landsOnBusinessDay dit si l'échéance tombe un jour travaillé", () => {
    const onWeekend = computeDueDate({
      rule: rule({
        anchor: DueAnchor.FIXED_DATE,
        fixed_month: 5,
        fixed_day: 2,
        weekend_shift: DateShift.NONE,
        holiday_shift: DateShift.NONE,
      }),
      period: period("2026", alger(2026, 1, 1), alger(2026, 12, 31), Periodicity.ANNUAL),
    });
    expect(onWeekend.ok).toBe(true);
    if (!onWeekend.ok) return;

    // Une échéance PEUT légitimement tomber un samedi : certaines
    // administrations comptent en jours calendaires.
    expect(landsOnBusinessDay(onWeekend.value)).toBe(false);
    expect(landsOnBusinessDay(onWeekend.value, [alger(2026, 5, 4)])).toBe(false);
  });
});

describe("ancre événementielle répétée", () => {
  /*
   * ⚠️ Une obligation ancrée sur un FAIT peut néanmoins se répéter : un agrément
   * à renouveler tous les deux ans part de la date d'expiration, puis avance
   * d'une période à chaque échéance. C'est le seul chemin qui exerce
   * `advanceByPeriodicity` — les périodicités calendaires ordinaires passent par
   * le découpage en périodes, jamais par cette fonction.
   */
  it.each([
    [Periodicity.MONTHLY, "2027-10-15"],
    [Periodicity.QUARTERLY, "2027-12-15"],
    [Periodicity.SEMIANNUAL, "2028-03-15"],
    [Periodicity.ANNUAL, "2028-09-15"],
    [Periodicity.BIENNIAL, "2029-09-15"],
  ])("avance d'une période %s à chaque renouvellement", (periodicity, secondAnchor) => {
    const result = previewDueDates({
      rule: {
        anchor: DueAnchor.EXPIRY_DATE,
        offset_days: 0,
        weekend_shift: "NONE",
        holiday_shift: "NONE",
      },
      periodicity,
      anchorDate: alger(2027, 9, 15),
      count: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toHaveLength(2);
    const [first, second] = result.value;
    if (first === undefined || second === undefined) throw new Error("lignes manquantes");
    expect(iso(first.rawDueDate)).toBe("2027-09-15");
    // La seconde échéance part de l'ancre AVANCÉE d'une période entière.
    expect(iso(second.rawDueDate)).toBe(secondAnchor);
  });
});
