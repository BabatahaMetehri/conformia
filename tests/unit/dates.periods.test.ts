import { describe, expect, it } from "vitest";

import { DateShift, Periodicity } from "@/config/constants";
import {
  buildPeriodKey,
  computePeriods,
  endOfPeriod,
  parsePeriodKey,
  previousBusinessDay,
  shiftDate,
  snapBackwardToBusinessDay,
  startOfPeriod,
} from "@/lib/dates";
import { AppError, AppErrorCode } from "@/lib/errors";

const at = (iso: string): Date => new Date(iso);

/**
 * Repères de janvier 2026, heure d'Alger (UTC+1) — midi local, donc 11:00 UTC.
 *  jeu. 01 · ven. 02 (week-end) · sam. 03 (week-end) · dim. 04 · lun. 05
 * Rappel : en Algérie le week-end est vendredi-samedi ; DIMANCHE EST OUVRÉ.
 */
const THU_01 = at("2026-01-01T11:00:00Z");
const FRI_02 = at("2026-01-02T11:00:00Z");
const SAT_03 = at("2026-01-03T11:00:00Z");
const SUN_04 = at("2026-01-04T11:00:00Z");
const MON_05 = at("2026-01-05T11:00:00Z");

// ─────────────────────────────────────────────────────────────────────────────

describe("shiftDate — report d'échéance", () => {
  it("laisse un jeudi ouvré en place (NEXT_BUSINESS_DAY)", () => {
    expect(shiftDate(THU_01, DateShift.NEXT_BUSINESS_DAY).toISOString()).toBe(THU_01.toISOString());
  });

  it("reporte un vendredi au dimanche (NEXT_BUSINESS_DAY)", () => {
    expect(shiftDate(FRI_02, DateShift.NEXT_BUSINESS_DAY).toISOString()).toBe(SUN_04.toISOString());
  });

  it("reporte un jeudi férié au dimanche : férié PUIS week-end", () => {
    // Double report exigé : jeudi chômé → vendredi (week-end) → samedi
    // (week-end) → dimanche. Une implémentation qui ne saute qu'une fois
    // renverrait vendredi.
    expect(shiftDate(THU_01, DateShift.NEXT_BUSINESS_DAY, [THU_01]).toISOString()).toBe(
      SUN_04.toISOString(),
    );
  });

  it("enchaîne férié, week-end et férié jusqu'au premier jour ouvré", () => {
    expect(shiftDate(THU_01, DateShift.NEXT_BUSINESS_DAY, [THU_01, SUN_04]).toISOString()).toBe(
      MON_05.toISOString(),
    );
  });

  it("ramène un samedi au jeudi (PREVIOUS_BUSINESS_DAY)", () => {
    // Recul symétrique : samedi → vendredi (week-end) → jeudi.
    expect(shiftDate(SAT_03, DateShift.PREVIOUS_BUSINESS_DAY).toISOString()).toBe(
      THU_01.toISOString(),
    );
  });

  it("ramène un dimanche férié au jeudi : férié PUIS week-end, en reculant", () => {
    expect(shiftDate(SUN_04, DateShift.PREVIOUS_BUSINESS_DAY, [SUN_04]).toISOString()).toBe(
      THU_01.toISOString(),
    );
  });

  it("laisse un dimanche ouvré en place (PREVIOUS_BUSINESS_DAY)", () => {
    // ⚠️ Dimanche est un jour OUVRÉ en Algérie : le report ne s'applique pas.
    expect(shiftDate(SUN_04, DateShift.PREVIOUS_BUSINESS_DAY).toISOString()).toBe(
      SUN_04.toISOString(),
    );
  });

  it("ne touche à rien avec NONE, même un jour chômé", () => {
    expect(shiftDate(FRI_02, DateShift.NONE).toISOString()).toBe(FRI_02.toISOString());
    expect(shiftDate(THU_01, DateShift.NONE, [THU_01]).toISOString()).toBe(THU_01.toISOString());
  });

  it("conserve l'heure de la journée", () => {
    const evening = at("2026-01-02T20:15:00Z");
    expect(shiftDate(evening, DateShift.NEXT_BUSINESS_DAY).toISOString()).toBe(
      "2026-01-04T20:15:00.000Z",
    );
  });
});

describe("previousBusinessDay — recul strict", () => {
  it("recule d'un jour ouvré depuis un dimanche, jusqu'au jeudi", () => {
    expect(previousBusinessDay(SUN_04).toISOString()).toBe(THU_01.toISOString());
  });

  it("est distinct du report, qui ne bouge pas un jour ouvré", () => {
    expect(snapBackwardToBusinessDay(SUN_04).toISOString()).toBe(SUN_04.toISOString());
    expect(previousBusinessDay(SUN_04).toISOString()).not.toBe(SUN_04.toISOString());
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("clés rectificatives", () => {
  const january = at("2026-01-15T12:00:00Z");

  it("produit la clé de base à l'indice 0", () => {
    expect(buildPeriodKey(january, Periodicity.MONTHLY)).toBe("2026-01");
    expect(buildPeriodKey(january, Periodicity.MONTHLY, 0)).toBe("2026-01");
  });

  it("suffixe les rectificatives", () => {
    expect(buildPeriodKey(january, Periodicity.MONTHLY, 1)).toBe("2026-01-R1");
    expect(buildPeriodKey(january, Periodicity.MONTHLY, 2)).toBe("2026-01-R2");
    expect(buildPeriodKey(january, Periodicity.MONTHLY, 12)).toBe("2026-01-R12");
  });

  it("décode une rectificative sans changer les bornes de la période", () => {
    const base = parsePeriodKey("2026-01");
    const rectified = parsePeriodKey("2026-01-R2");

    expect(rectified.base).toBe("2026-01");
    expect(rectified.rectificationIndex).toBe(2);
    expect(rectified.periodicity).toBe(Periodicity.MONTHLY);
    expect(rectified.start.toISOString()).toBe(base.start.toISOString());
    expect(rectified.end.toISOString()).toBe(base.end.toISOString());
  });

  it("expose un indice 0 pour une clé de base", () => {
    const parsed = parsePeriodKey("2026-Q1");
    expect(parsed.base).toBe("2026-Q1");
    expect(parsed.rectificationIndex).toBe(0);
  });

  it.each([
    ["2026-01", Periodicity.MONTHLY],
    ["2026-Q3", Periodicity.QUARTERLY],
    ["2026-S2", Periodicity.SEMIANNUAL],
    ["2026", Periodicity.ANNUAL],
    ["2026-2027", Periodicity.BIENNIAL],
    ["2026-D0331", Periodicity.CUSTOM],
    ["2026-E0315", Periodicity.ON_EVENT],
  ])("fait un aller-retour exact sur %s et sa rectificative", (base, periodicity) => {
    for (const index of [0, 1, 7]) {
      const key = index === 0 ? base : `${base}-R${String(index)}`;
      const parsed = parsePeriodKey(key);

      expect(parsed.base).toBe(base);
      expect(parsed.rectificationIndex).toBe(index);
      expect(parsed.periodicity).toBe(periodicity);
      expect(buildPeriodKey(parsed.start, periodicity, index)).toBe(key);
      expect(buildPeriodKey(parsed.end, periodicity, index)).toBe(key);
    }
  });

  it("refuse un indice rectificatif invalide à la construction", () => {
    expect(() => buildPeriodKey(january, Periodicity.MONTHLY, -1)).toThrow(AppError);
    expect(() => buildPeriodKey(january, Periodicity.MONTHLY, 1.5)).toThrow(AppError);
  });

  it.each(["2026-01-R0", "2026-01-R", "2026-01-R-1", "2026-01-Rx"])(
    "refuse la clé rectificative malformée %s",
    (key) => {
      expect(() => parsePeriodKey(key)).toThrow(AppError);
    },
  );
});

describe("clés des nouvelles périodicités", () => {
  it("aligne les bienniums sur les années paires", () => {
    expect(buildPeriodKey(at("2026-03-03T12:00:00Z"), Periodicity.BIENNIAL)).toBe("2026-2027");
    expect(buildPeriodKey(at("2027-03-03T12:00:00Z"), Periodicity.BIENNIAL)).toBe("2026-2027");
    expect(buildPeriodKey(at("2028-03-03T12:00:00Z"), Periodicity.BIENNIAL)).toBe("2028-2029");
  });

  it("borne un biennium sur deux années civiles algériennes", () => {
    const anchor = at("2027-06-15T12:00:00Z");
    expect(startOfPeriod(anchor, Periodicity.BIENNIAL).toISOString()).toBe(
      "2025-12-31T23:00:00.000Z",
    );
    expect(endOfPeriod(anchor, Periodicity.BIENNIAL).toISOString()).toBe(
      "2027-12-31T22:59:59.999Z",
    );
  });

  it("réduit CUSTOM et ON_EVENT au jour porteur", () => {
    const anchor = at("2026-03-31T12:00:00Z");
    expect(startOfPeriod(anchor, Periodicity.CUSTOM).toISOString()).toBe(
      "2026-03-30T23:00:00.000Z",
    );
    expect(endOfPeriod(anchor, Periodicity.CUSTOM).toISOString()).toBe("2026-03-31T22:59:59.999Z");
    expect(buildPeriodKey(anchor, Periodicity.CUSTOM)).toBe("2026-D0331");
    expect(buildPeriodKey(anchor, Periodicity.ON_EVENT)).toBe("2026-E0331");
  });

  it("refuse un biennium non canonique", () => {
    expect(() => parsePeriodKey("2027-2028")).toThrow(AppError);
    expect(() => parsePeriodKey("2026-2028")).toThrow(AppError);
  });

  it("refuse un jour civil inexistant", () => {
    expect(() => parsePeriodKey("2026-D0231")).toThrow(AppError);
    expect(() => parsePeriodKey("2026-E0431")).toThrow(AppError);
  });

  it("classe la clé malformée en VALIDATION_FAILED", () => {
    try {
      parsePeriodKey("2026-D0231");
      throw new Error("attendu : échec");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      if (error instanceof AppError) {
        expect(error.code).toBe(AppErrorCode.VALIDATION_FAILED);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("computePeriods — périodicités calendaires", () => {
  it("génère les mois d'un intervalle", () => {
    const periods = computePeriods(
      { periodicity: Periodicity.MONTHLY },
      { from: at("2026-01-15T00:00:00Z"), to: at("2026-03-10T00:00:00Z") },
    );
    expect(periods.map((period) => period.key)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(periods[0]?.start.toISOString()).toBe("2025-12-31T23:00:00.000Z");
    expect(periods[0]?.end.toISOString()).toBe("2026-01-31T22:59:59.999Z");
  });

  it("génère les quatre trimestres d'une année", () => {
    const periods = computePeriods(
      { periodicity: Periodicity.QUARTERLY },
      { from: at("2026-01-01T00:00:00Z"), to: at("2026-12-31T00:00:00Z") },
    );
    expect(periods.map((period) => period.key)).toEqual([
      "2026-Q1",
      "2026-Q2",
      "2026-Q3",
      "2026-Q4",
    ]);
  });

  it("génère les deux semestres et l'année", () => {
    const range = { from: at("2026-01-01T00:00:00Z"), to: at("2026-12-31T00:00:00Z") };
    expect(
      computePeriods({ periodicity: Periodicity.SEMIANNUAL }, range).map((p) => p.key),
    ).toEqual(["2026-S1", "2026-S2"]);
    expect(computePeriods({ periodicity: Periodicity.ANNUAL }, range).map((p) => p.key)).toEqual([
      "2026",
    ]);
  });

  it("génère les bienniums alignés sur les années paires", () => {
    const periods = computePeriods(
      { periodicity: Periodicity.BIENNIAL },
      { from: at("2026-01-01T00:00:00Z"), to: at("2029-12-31T00:00:00Z") },
    );
    expect(periods.map((period) => period.key)).toEqual(["2026-2027", "2028-2029"]);
  });

  it("inclut la période à cheval sur la borne de départ sans la tronquer", () => {
    const [first] = computePeriods(
      { periodicity: Periodicity.MONTHLY },
      { from: at("2026-01-20T00:00:00Z"), to: at("2026-01-25T00:00:00Z") },
    );
    expect(first?.key).toBe("2026-01");
    expect(first?.start.toISOString()).toBe("2025-12-31T23:00:00.000Z");
  });

  it("respecte l'horizon de génération", () => {
    const periods = computePeriods(
      { periodicity: Periodicity.MONTHLY },
      { from: at("2026-01-01T00:00:00Z"), to: at("2027-06-30T00:00:00Z") },
    );
    expect(periods).toHaveLength(18);
  });

  it("refuse un intervalle inversé", () => {
    expect(() =>
      computePeriods(
        { periodicity: Periodicity.ANNUAL },
        { from: at("2027-01-01T00:00:00Z"), to: at("2026-01-01T00:00:00Z") },
      ),
    ).toThrow(AppError);
  });
});

describe("computePeriods — ON_EVENT", () => {
  it("ne génère rien : l'occurrence naît du fait déclencheur", () => {
    expect(
      computePeriods(
        { periodicity: Periodicity.ON_EVENT },
        { from: at("2020-01-01T00:00:00Z"), to: at("2030-12-31T00:00:00Z") },
      ),
    ).toEqual([]);
  });
});

describe("computePeriods — CUSTOM", () => {
  const threeFixedDates = [
    { month: 3, day: 31 },
    { month: 6, day: 30 },
    { month: 9, day: 30 },
  ] as const;

  it("génère trois périodes par an à partir de trois dates fixes", () => {
    const periods = computePeriods(
      { periodicity: Periodicity.CUSTOM, occurrences: threeFixedDates },
      { from: at("2026-01-01T00:00:00Z"), to: at("2026-12-31T00:00:00Z") },
    );

    expect(periods).toHaveLength(3);
    expect(periods.map((period) => period.key)).toEqual(["2026-D0331", "2026-D0630", "2026-D0930"]);
  });

  it("répète les dates fixes sur chaque année de l'intervalle", () => {
    const periods = computePeriods(
      { periodicity: Periodicity.CUSTOM, occurrences: threeFixedDates },
      { from: at("2026-01-01T00:00:00Z"), to: at("2027-12-31T00:00:00Z") },
    );
    expect(periods).toHaveLength(6);
    expect(periods.map((period) => period.key)).toEqual([
      "2026-D0331",
      "2026-D0630",
      "2026-D0930",
      "2027-D0331",
      "2027-D0630",
      "2027-D0930",
    ]);
  });

  it("rend les périodes triées, quel que soit l'ordre des dates de la règle", () => {
    const periods = computePeriods(
      {
        periodicity: Periodicity.CUSTOM,
        occurrences: [
          { month: 9, day: 30 },
          { month: 3, day: 31 },
        ],
      },
      { from: at("2026-01-01T00:00:00Z"), to: at("2026-12-31T00:00:00Z") },
    );
    expect(periods.map((period) => period.key)).toEqual(["2026-D0331", "2026-D0930"]);
  });

  it("exclut les dates hors de l'intervalle", () => {
    const periods = computePeriods(
      { periodicity: Periodicity.CUSTOM, occurrences: threeFixedDates },
      { from: at("2026-05-01T00:00:00Z"), to: at("2026-07-31T00:00:00Z") },
    );
    expect(periods.map((period) => period.key)).toEqual(["2026-D0630"]);
  });

  it("borne chaque période sur la journée algérienne concernée", () => {
    const [first] = computePeriods(
      { periodicity: Periodicity.CUSTOM, occurrences: [{ month: 3, day: 31 }] },
      { from: at("2026-01-01T00:00:00Z"), to: at("2026-12-31T00:00:00Z") },
    );
    expect(first?.start.toISOString()).toBe("2026-03-30T23:00:00.000Z");
    expect(first?.end.toISOString()).toBe("2026-03-31T22:59:59.999Z");
  });

  it("ramène un jour trop grand au dernier jour réel du mois", () => {
    const periods = computePeriods(
      { periodicity: Periodicity.CUSTOM, occurrences: [{ month: 2, day: 31 }] },
      { from: at("2026-01-01T00:00:00Z"), to: at("2028-12-31T00:00:00Z") },
    );
    // 2028 est bissextile : le 29 février existe.
    expect(periods.map((period) => period.key)).toEqual(["2026-D0228", "2027-D0228", "2028-D0229"]);
  });

  it("rend un tableau vide si la règle ne porte aucune date", () => {
    expect(
      computePeriods(
        { periodicity: Periodicity.CUSTOM, occurrences: [] },
        { from: at("2026-01-01T00:00:00Z"), to: at("2026-12-31T00:00:00Z") },
      ),
    ).toEqual([]);
  });

  it.each([
    [{ month: 0, day: 1 }],
    [{ month: 13, day: 1 }],
    [{ month: 1, day: 0 }],
    [{ month: 1, day: 32 }],
    [{ month: 1.5, day: 1 }],
  ])("refuse la date fixe invalide %o", (spec) => {
    expect(() =>
      computePeriods(
        { periodicity: Periodicity.CUSTOM, occurrences: [spec] },
        { from: at("2026-01-01T00:00:00Z"), to: at("2026-12-31T00:00:00Z") },
      ),
    ).toThrow(AppError);
  });
});
