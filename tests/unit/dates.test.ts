import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Periodicity } from "@/config/constants";
import {
  APP_TIMEZONE,
  WEEKEND_DAYS,
  WeekDay,
  addBusinessDays,
  buildPeriodKey,
  daysUntil,
  endOfPeriod,
  formatDateFr,
  formatDateTimeFr,
  isBusinessDay,
  nextBusinessDay,
  nowInAppTz,
  parsePeriodKey,
  snapForwardToBusinessDay,
  startOfPeriod,
  toAppTz,
  toUtcFromAppTz,
} from "@/lib/dates";
import { AppError, AppErrorCode } from "@/lib/errors";

/** Raccourci de lisibilité : un instant absolu, écrit en UTC. */
const at = (iso: string): Date => new Date(iso);

/**
 * Repères de janvier 2026, heure d'Alger (UTC+1) — midi local, donc 11:00 UTC.
 *  jeu. 01 · ven. 02 (week-end) · sam. 03 (week-end) · dim. 04 · lun. 05
 */
const THU_01 = at("2026-01-01T11:00:00Z");
const FRI_02 = at("2026-01-02T11:00:00Z");
const SAT_03 = at("2026-01-03T11:00:00Z");
const SUN_04 = at("2026-01-04T11:00:00Z");
const MON_05 = at("2026-01-05T11:00:00Z");

describe("fuseau et conversions", () => {
  it("est ancré sur Africa/Algiers", () => {
    expect(APP_TIMEZONE).toBe("Africa/Algiers");
  });

  it("fait un aller-retour exact instant → zoné → instant", () => {
    for (const iso of [
      "2026-01-15T10:00:00.000Z",
      "2025-12-31T23:00:00.000Z",
      "2024-02-29T00:00:00.000Z",
      "2026-07-01T13:37:42.123Z",
    ]) {
      expect(toUtcFromAppTz(toAppTz(at(iso))).toISOString()).toBe(iso);
    }
  });

  it("décale d'une heure vers l'avant (UTC+1, sans heure d'été)", () => {
    const zoned = toAppTz(at("2026-01-15T10:00:00Z"));
    expect(zoned.getTime() - at("2026-01-15T10:00:00Z").getTime()).toBe(3_600_000);
  });
});

describe("nowInAppTz", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reflète l'horloge courante et se reconvertit à l'identique", () => {
    vi.setSystemTime(at("2026-01-15T10:00:00Z"));
    expect(toUtcFromAppTz(nowInAppTz()).toISOString()).toBe("2026-01-15T10:00:00.000Z");
  });
});

describe("startOfPeriod / endOfPeriod", () => {
  it("borne un mois", () => {
    const anchor = at("2026-01-15T12:00:00Z");
    expect(startOfPeriod(anchor, Periodicity.MONTHLY).toISOString()).toBe(
      "2025-12-31T23:00:00.000Z",
    );
    expect(endOfPeriod(anchor, Periodicity.MONTHLY).toISOString()).toBe("2026-01-31T22:59:59.999Z");
  });

  it("borne un trimestre", () => {
    const anchor = at("2026-05-10T12:00:00Z");
    expect(startOfPeriod(anchor, Periodicity.QUARTERLY).toISOString()).toBe(
      "2026-03-31T23:00:00.000Z",
    );
    expect(endOfPeriod(anchor, Periodicity.QUARTERLY).toISOString()).toBe(
      "2026-06-30T22:59:59.999Z",
    );
  });

  it("borne le premier semestre", () => {
    const anchor = at("2026-03-10T12:00:00Z");
    expect(startOfPeriod(anchor, Periodicity.SEMIANNUAL).toISOString()).toBe(
      "2025-12-31T23:00:00.000Z",
    );
    expect(endOfPeriod(anchor, Periodicity.SEMIANNUAL).toISOString()).toBe(
      "2026-06-30T22:59:59.999Z",
    );
  });

  it("borne le second semestre", () => {
    const anchor = at("2026-08-15T12:00:00Z");
    expect(startOfPeriod(anchor, Periodicity.SEMIANNUAL).toISOString()).toBe(
      "2026-06-30T23:00:00.000Z",
    );
    expect(endOfPeriod(anchor, Periodicity.SEMIANNUAL).toISOString()).toBe(
      "2026-12-31T22:59:59.999Z",
    );
  });

  it("borne une année", () => {
    const anchor = at("2026-05-10T12:00:00Z");
    expect(startOfPeriod(anchor, Periodicity.ANNUAL).toISOString()).toBe(
      "2025-12-31T23:00:00.000Z",
    );
    expect(endOfPeriod(anchor, Periodicity.ANNUAL).toISOString()).toBe("2026-12-31T22:59:59.999Z");
  });

  it("gère le 29 février d'une année bissextile", () => {
    expect(endOfPeriod(at("2024-02-10T12:00:00Z"), Periodicity.MONTHLY).toISOString()).toBe(
      "2024-02-29T22:59:59.999Z",
    );
  });

  it("gère février d'une année non bissextile", () => {
    expect(endOfPeriod(at("2025-02-10T12:00:00Z"), Periodicity.MONTHLY).toISOString()).toBe(
      "2025-02-28T22:59:59.999Z",
    );
  });

  it("gère 2100, année séculaire non bissextile", () => {
    expect(endOfPeriod(at("2100-02-10T12:00:00Z"), Periodicity.MONTHLY).toISOString()).toBe(
      "2100-02-28T22:59:59.999Z",
    );
  });
});

describe("frontières de période décalées par le fuseau", () => {
  it("range 23h30 UTC le 31 décembre dans le mois de janvier suivant", () => {
    const instant = at("2025-12-31T23:30:00Z"); // 1ᵉʳ janvier 00h30 à Alger
    expect(buildPeriodKey(instant, Periodicity.MONTHLY)).toBe("2026-01");
    expect(buildPeriodKey(instant, Periodicity.ANNUAL)).toBe("2026");
  });

  it("laisse 22h30 UTC le 31 décembre dans le mois de décembre", () => {
    const instant = at("2025-12-31T22:30:00Z"); // 31 décembre 23h30 à Alger
    expect(buildPeriodKey(instant, Periodicity.MONTHLY)).toBe("2025-12");
    expect(buildPeriodKey(instant, Periodicity.ANNUAL)).toBe("2025");
  });

  it("fait basculer une période à cheval sur deux mois", () => {
    const instant = at("2026-01-31T23:30:00Z"); // 1ᵉʳ février 00h30 à Alger
    expect(buildPeriodKey(instant, Periodicity.MONTHLY)).toBe("2026-02");
    expect(startOfPeriod(instant, Periodicity.MONTHLY).toISOString()).toBe(
      "2026-01-31T23:00:00.000Z",
    );
    expect(endOfPeriod(instant, Periodicity.MONTHLY).toISOString()).toBe(
      "2026-02-28T22:59:59.999Z",
    );
  });
});

describe("buildPeriodKey", () => {
  const anchor = at("2026-05-10T12:00:00Z");

  it("formate les quatre périodicités", () => {
    expect(buildPeriodKey(at("2026-01-15T12:00:00Z"), Periodicity.MONTHLY)).toBe("2026-01");
    expect(buildPeriodKey(anchor, Periodicity.MONTHLY)).toBe("2026-05");
    expect(buildPeriodKey(anchor, Periodicity.QUARTERLY)).toBe("2026-Q2");
    expect(buildPeriodKey(anchor, Periodicity.SEMIANNUAL)).toBe("2026-S1");
    expect(buildPeriodKey(anchor, Periodicity.ANNUAL)).toBe("2026");
  });

  it("couvre les quatre trimestres et les deux semestres", () => {
    expect(buildPeriodKey(at("2026-02-01T12:00:00Z"), Periodicity.QUARTERLY)).toBe("2026-Q1");
    expect(buildPeriodKey(at("2026-08-01T12:00:00Z"), Periodicity.QUARTERLY)).toBe("2026-Q3");
    expect(buildPeriodKey(at("2026-11-01T12:00:00Z"), Periodicity.QUARTERLY)).toBe("2026-Q4");
    expect(buildPeriodKey(at("2026-11-01T12:00:00Z"), Periodicity.SEMIANNUAL)).toBe("2026-S2");
  });
});

describe("parsePeriodKey", () => {
  const cases: readonly (readonly [string, Periodicity, string, string])[] = [
    ["2026-01", Periodicity.MONTHLY, "2025-12-31T23:00:00.000Z", "2026-01-31T22:59:59.999Z"],
    ["2026-12", Periodicity.MONTHLY, "2026-11-30T23:00:00.000Z", "2026-12-31T22:59:59.999Z"],
    ["2024-02", Periodicity.MONTHLY, "2024-01-31T23:00:00.000Z", "2024-02-29T22:59:59.999Z"],
    ["2026-Q1", Periodicity.QUARTERLY, "2025-12-31T23:00:00.000Z", "2026-03-31T22:59:59.999Z"],
    ["2026-Q4", Periodicity.QUARTERLY, "2026-09-30T23:00:00.000Z", "2026-12-31T22:59:59.999Z"],
    ["2026-S1", Periodicity.SEMIANNUAL, "2025-12-31T23:00:00.000Z", "2026-06-30T22:59:59.999Z"],
    ["2026-S2", Periodicity.SEMIANNUAL, "2026-06-30T23:00:00.000Z", "2026-12-31T22:59:59.999Z"],
    ["2026", Periodicity.ANNUAL, "2025-12-31T23:00:00.000Z", "2026-12-31T22:59:59.999Z"],
  ];

  it.each(cases)("décode %s", (key, periodicity, start, end) => {
    const bounds = parsePeriodKey(key);
    expect(bounds.periodicity).toBe(periodicity);
    expect(bounds.start.toISOString()).toBe(start);
    expect(bounds.end.toISOString()).toBe(end);
  });

  it.each(cases)("est l'inverse exact de buildPeriodKey pour %s", (key, periodicity) => {
    const bounds = parsePeriodKey(key);
    expect(buildPeriodKey(bounds.start, periodicity)).toBe(key);
    expect(buildPeriodKey(bounds.end, periodicity)).toBe(key);
  });

  it("encadre strictement la période : 1 ms avant le début est hors période", () => {
    const bounds = parsePeriodKey("2026-01");
    const justBefore = new Date(bounds.start.getTime() - 1);
    const justAfter = new Date(bounds.end.getTime() + 1);
    expect(buildPeriodKey(justBefore, Periodicity.MONTHLY)).toBe("2025-12");
    expect(buildPeriodKey(justAfter, Periodicity.MONTHLY)).toBe("2026-02");
  });

  it.each(["2026-13", "2026-00", "2026-Q5", "2026-Q0", "2026-S3", "26-01", "2026-1", "", "abc"])(
    "rejette la clé malformée %s",
    (key) => {
      expect(() => parsePeriodKey(key)).toThrow(AppError);
      try {
        parsePeriodKey(key);
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        if (error instanceof AppError) {
          expect(error.code).toBe(AppErrorCode.VALIDATION_FAILED);
        }
      }
    },
  );
});

describe("semaine ouvrée algérienne", () => {
  it("place le week-end vendredi et samedi", () => {
    expect(WEEKEND_DAYS).toEqual([WeekDay.FRIDAY, WeekDay.SATURDAY]);
  });

  it("qualifie correctement chaque jour", () => {
    expect(isBusinessDay(THU_01)).toBe(true);
    expect(isBusinessDay(FRI_02)).toBe(false);
    expect(isBusinessDay(SAT_03)).toBe(false);
    expect(isBusinessDay(SUN_04)).toBe(true);
  });

  it("exclut un jour férié", () => {
    expect(isBusinessDay(SUN_04, [SUN_04])).toBe(false);
  });

  it("reconnaît un férié quelle que soit l'heure fournie", () => {
    // 4 janvier 00h00 à Alger, exprimé en UTC.
    expect(isBusinessDay(SUN_04, [at("2026-01-03T23:00:00Z")])).toBe(false);
  });
});

describe("addBusinessDays", () => {
  it("saute le week-end", () => {
    expect(addBusinessDays(THU_01, 1).toISOString()).toBe(SUN_04.toISOString());
    expect(addBusinessDays(THU_01, 2).toISOString()).toBe(MON_05.toISOString());
  });

  it("laisse l'instant intact pour un décalage nul", () => {
    expect(addBusinessDays(FRI_02, 0).toISOString()).toBe(FRI_02.toISOString());
  });

  it("remonte le temps avec un décalage négatif", () => {
    expect(addBusinessDays(SUN_04, -1).toISOString()).toBe(THU_01.toISOString());
    expect(addBusinessDays(MON_05, -2).toISOString()).toBe(THU_01.toISOString());
  });

  it("saute aussi les jours fériés", () => {
    expect(addBusinessDays(THU_01, 1, [SUN_04]).toISOString()).toBe(MON_05.toISOString());
  });

  it("conserve l'heure de la journée", () => {
    const evening = at("2026-01-01T20:15:00Z");
    expect(addBusinessDays(evening, 1).toISOString()).toBe("2026-01-04T20:15:00.000Z");
  });
});

describe("nextBusinessDay", () => {
  it("avance strictement, même depuis un jour ouvré", () => {
    expect(nextBusinessDay(THU_01).toISOString()).toBe(SUN_04.toISOString());
  });

  it("sort du week-end", () => {
    expect(nextBusinessDay(FRI_02).toISOString()).toBe(SUN_04.toISOString());
    expect(nextBusinessDay(SAT_03).toISOString()).toBe(SUN_04.toISOString());
  });
});

describe("snapForwardToBusinessDay — report d'échéance", () => {
  it("laisse une échéance déjà ouvrée intacte", () => {
    expect(snapForwardToBusinessDay(THU_01).toISOString()).toBe(THU_01.toISOString());
  });

  it("reporte une échéance tombant un week-end", () => {
    expect(snapForwardToBusinessDay(FRI_02).toISOString()).toBe(SUN_04.toISOString());
    expect(snapForwardToBusinessDay(SAT_03).toISOString()).toBe(SUN_04.toISOString());
  });

  it("reporte une échéance tombant un jour férié", () => {
    expect(snapForwardToBusinessDay(SUN_04, [SUN_04]).toISOString()).toBe(MON_05.toISOString());
  });

  it("reporte un férié accolé au week-end jusqu'au premier jour ouvré", () => {
    // Jeudi férié, puis vendredi et samedi chômés : on tombe au dimanche.
    expect(snapForwardToBusinessDay(THU_01, [THU_01]).toISOString()).toBe(SUN_04.toISOString());
  });

  it("enchaîne férié, week-end et férié", () => {
    // Jeudi férié + week-end + dimanche férié : premier jour ouvré = lundi.
    expect(snapForwardToBusinessDay(THU_01, [THU_01, SUN_04]).toISOString()).toBe(
      MON_05.toISOString(),
    );
  });
});

describe("formatage français", () => {
  it("formate une date", () => {
    expect(formatDateFr(at("2026-01-15T10:00:00Z"))).toBe("15/01/2026");
  });

  it("formate une date-heure à l'heure d'Alger", () => {
    expect(formatDateTimeFr(at("2026-01-15T10:00:00Z"))).toBe("15/01/2026 11:00");
  });

  it("bascule au jour suivant après 23h00 UTC", () => {
    expect(formatDateFr(at("2026-01-15T23:30:00Z"))).toBe("16/01/2026");
    expect(formatDateTimeFr(at("2026-01-15T23:30:00Z"))).toBe("16/01/2026 00:30");
  });
});

describe("daysUntil", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(at("2026-01-15T10:00:00Z")); // 15 janvier 11h00 à Alger
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("compte les jours civils restants", () => {
    expect(daysUntil(at("2026-01-20T10:00:00Z"))).toBe(5);
  });

  it("compte 0 pour le jour même", () => {
    expect(daysUntil(at("2026-01-15T22:00:00Z"))).toBe(0);
  });

  it("compte des jours civils, pas des tranches de 24 h", () => {
    // 23h00 UTC = 16 janvier 00h00 à Alger : un jour civil d'écart, 13 h réelles.
    expect(daysUntil(at("2026-01-15T23:00:00Z"))).toBe(1);
  });

  it("devient négatif pour une échéance dépassée", () => {
    expect(daysUntil(at("2026-01-10T10:00:00Z"))).toBe(-5);
  });

  it("accepte une origine explicite", () => {
    expect(daysUntil(at("2026-03-01T10:00:00Z"), at("2026-02-01T10:00:00Z"))).toBe(28);
    expect(daysUntil(at("2024-03-01T10:00:00Z"), at("2024-02-01T10:00:00Z"))).toBe(29);
  });
});
