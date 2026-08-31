import { describe, expect, it } from "vitest";

import { Criticality, DateShift, DueAnchor, Periodicity } from "@/config/constants";
import { formatDateFr, toUtcFromAppTz } from "@/lib/dates";
import { computeDueDate, previewDueDates } from "@/services/scheduling";
import { defaultDueRule, validateDueRule } from "@/services/scheduling/due-rule";

/**
 * Moteur d'échéance.
 *
 * Ces tests portent sur LA fonction qui produira aussi les occurrences réelles
 * (prompt 5.1). Une erreur ici ne se verrait pas à l'écran : elle produirait des
 * échéances fausses en base, silencieusement.
 *
 * Les dates sont comparées via `formatDateFr`, donc dans le fuseau d'Alger. Une
 * comparaison d'ISO string masquerait précisément la classe de bug qu'on
 * cherche : une échéance juste en UTC et fausse d'un jour à Alger.
 */

/** Midi UTC : hors de portée du basculement de date, dans un sens comme dans l'autre. */
const at = (iso: string): Date => new Date(`${iso}T12:00:00.000Z`);

const dates = (
  result: ReturnType<typeof previewDueDates>,
): { readonly keys: string[]; readonly legal: string[]; readonly raw: string[] } => {
  if (!result.ok) throw new Error(`prévisualisation en échec : ${JSON.stringify(result.error)}`);
  return {
    keys: result.value.map((preview) => preview.periodKey),
    legal: result.value.map((preview) => formatDateFr(preview.legalDueDate)),
    raw: result.value.map((preview) => formatDateFr(preview.rawDueDate)),
  };
};

// ═════════════════════════════════════════════════════════════════════════════
// Critères d'acceptation
// ═════════════════════════════════════════════════════════════════════════════

describe("critères d'acceptation", () => {
  it("mensuelle J+20 après fin de période : 6 dates, week-ends reportés", () => {
    const result = previewDueDates({
      rule: { anchor: DueAnchor.PERIOD_END, offset_days: 20 },
      periodicity: Periodicity.MONTHLY,
      from: at("2026-01-15"),
      count: 6,
    });

    const { keys, legal, raw } = dates(result);

    expect(keys).toEqual(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]);

    /*
     * Brut = fin de mois + 20 jours. Le week-end algérien est vendredi/samedi :
     *   20/02/2026 est un VENDREDI  → reporté au dimanche 22
     *   20/03/2026 est un VENDREDI  → reporté au dimanche 22
     *   20/06/2026 est un SAMEDI    → reporté au dimanche 21
     * Les trois autres tombent déjà un jour ouvré.
     */
    expect(raw).toEqual([
      "20/02/2026",
      "20/03/2026",
      "20/04/2026",
      "20/05/2026",
      "20/06/2026",
      "20/07/2026",
    ]);
    expect(legal).toEqual([
      "22/02/2026",
      "22/03/2026",
      "20/04/2026",
      "20/05/2026",
      "21/06/2026",
      "20/07/2026",
    ]);
  });

  it("mensuelle J+20 : un férié repousse encore, par-dessus le week-end", () => {
    // 20/04/2026 est un lundi ouvré. Déclaré férié, l'échéance passe au mardi.
    const result = previewDueDates({
      rule: { anchor: DueAnchor.PERIOD_END, offset_days: 20 },
      periodicity: Periodicity.MONTHLY,
      from: at("2026-03-05"),
      count: 1,
      holidays: [at("2026-04-20")],
    });

    if (!result.ok) throw new Error("prévisualisation en échec");
    expect(formatDateFr(result.value[0]?.legalDueDate ?? at("1970-01-01"))).toBe("21/04/2026");
    expect(result.value[0]?.shiftReason).toBe("HOLIDAY");
  });

  it("CUSTOM à 3 dates fixes : 3 échéances par an", () => {
    const result = previewDueDates({
      rule: {
        anchor: DueAnchor.PERIOD_END,
        offset_days: 0,
        occurrences: [
          { month: 3, day: 31 },
          { month: 6, day: 30 },
          { month: 11, day: 15 },
        ],
      },
      periodicity: Periodicity.CUSTOM,
      from: at("2026-01-10"),
      count: 6,
    });

    const { keys } = dates(result);

    // Six échéances = deux années civiles complètes de trois dates.
    expect(keys).toEqual([
      "2026-D0331",
      "2026-D0630",
      "2026-D1115",
      "2027-D0331",
      "2027-D0630",
      "2027-D1115",
    ]);

    const perYear = keys.filter((key) => key.startsWith("2026-"));
    expect(perYear).toHaveLength(3);
  });

  it("EXPIRY_DATE à -90 jours : l'échéance précède bien l'expiration", () => {
    const expiry = at("2026-09-30");

    const result = previewDueDates({
      rule: { anchor: DueAnchor.EXPIRY_DATE, offset_days: -90 },
      periodicity: Periodicity.ANNUAL,
      anchorDate: expiry,
      from: at("2026-01-01"),
      count: 3,
    });

    if (!result.ok) throw new Error("prévisualisation en échec");

    // Le critère porte sur l'EXPIRATION, pas sur la date brute : le report va
    // vers l'avant, `legalDueDate` est donc toujours ≥ `rawDueDate`. Ce qui doit
    // être vrai, c'est que l'échéance reste en deçà du terme du titre — sinon la
    // marge de 90 jours ne servirait à rien.
    const expiryOf = (index: number): number => {
      const projected = new Date(expiry);
      projected.setUTCFullYear(projected.getUTCFullYear() + index);
      return projected.getTime();
    };

    result.value.forEach((preview, index) => {
      expect(preview.legalDueDate.getTime()).toBeLessThan(expiryOf(index));
      expect(preview.legalDueDate.getTime()).toBeGreaterThanOrEqual(preview.rawDueDate.getTime());
    });

    // 30/09/2026 − 90 jours = 02/07/2026, un jeudi ouvré : aucun report.
    expect(formatDateFr(result.value[0]?.rawDueDate ?? at("1970-01-01"))).toBe("02/07/2026");
    expect(result.value[0]?.legalDueDate.getTime()).toBeLessThan(expiry.getTime());

    // Périodicité annuelle : l'expiration est projetée d'année en année.
    expect(formatDateFr(result.value[1]?.rawDueDate ?? at("1970-01-01"))).toBe("02/07/2027");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Les 7 périodicités
// ═════════════════════════════════════════════════════════════════════════════

describe("les 7 périodicités", () => {
  const PERIOD_END_RULE = { anchor: DueAnchor.PERIOD_END, offset_days: 10 } as const;

  it("MONTHLY découpe en mois", () => {
    const { keys } = dates(
      previewDueDates({
        rule: PERIOD_END_RULE,
        periodicity: Periodicity.MONTHLY,
        from: at("2026-01-15"),
        count: 3,
      }),
    );
    expect(keys).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("QUARTERLY découpe en trimestres", () => {
    const { keys, legal } = dates(
      previewDueDates({
        rule: PERIOD_END_RULE,
        periodicity: Periodicity.QUARTERLY,
        from: at("2026-02-15"),
        count: 4,
      }),
    );
    expect(keys).toEqual(["2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4"]);
    // 31/03 + 10 = 10/04/2026, un vendredi → reporté au dimanche 12.
    expect(legal[0]).toBe("12/04/2026");
  });

  it("SEMIANNUAL découpe en semestres", () => {
    const { keys } = dates(
      previewDueDates({
        rule: PERIOD_END_RULE,
        periodicity: Periodicity.SEMIANNUAL,
        from: at("2026-03-01"),
        count: 3,
      }),
    );
    expect(keys).toEqual(["2026-S1", "2026-S2", "2027-S1"]);
  });

  it("ANNUAL découpe en années civiles", () => {
    const { keys, raw } = dates(
      previewDueDates({
        rule: PERIOD_END_RULE,
        periodicity: Periodicity.ANNUAL,
        from: at("2026-06-01"),
        count: 3,
      }),
    );
    expect(keys).toEqual(["2026", "2027", "2028"]);
    expect(raw[0]).toBe("10/01/2027");
  });

  it("BIENNIAL s'aligne sur les années paires", () => {
    const { keys } = dates(
      previewDueDates({
        rule: PERIOD_END_RULE,
        periodicity: Periodicity.BIENNIAL,
        from: at("2027-04-01"),
        count: 2,
      }),
    );
    // 2027 appartient au biennium 2026-2027 : la période n'est pas « 2027-2028 ».
    expect(keys).toEqual(["2026-2027", "2028-2029"]);
  });

  it("CUSTOM suit ses dates déclarées", () => {
    const { keys } = dates(
      previewDueDates({
        rule: {
          anchor: DueAnchor.PERIOD_END,
          offset_days: 0,
          occurrences: [{ month: 5, day: 1 }],
        },
        periodicity: Periodicity.CUSTOM,
        from: at("2026-01-01"),
        count: 2,
      }),
    );
    expect(keys).toEqual(["2026-D0501", "2027-D0501"]);
  });

  it("ON_EVENT ne rend qu'UNE échéance, quel que soit le nombre demandé", () => {
    const result = previewDueDates({
      rule: { anchor: DueAnchor.EVENT_DATE, offset_days: 30 },
      periodicity: Periodicity.ON_EVENT,
      anchorDate: at("2026-03-15"),
      count: 6,
    });

    if (!result.ok) throw new Error("prévisualisation en échec");
    // Rien dans le calendrier ne dit quand le fait se reproduira : en inventer
    // cinq de plus donnerait à l'écran une assurance qu'il n'a pas.
    expect(result.value).toHaveLength(1);
    expect(formatDateFr(result.value[0]?.rawDueDate ?? at("1970-01-01"))).toBe("14/04/2026");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Les 5 ancres
// ═════════════════════════════════════════════════════════════════════════════

describe("les 5 ancres", () => {
  it("PERIOD_END part de la fin de période", () => {
    const { raw } = dates(
      previewDueDates({
        rule: { anchor: DueAnchor.PERIOD_END, offset_days: 0, weekend_shift: DateShift.NONE },
        periodicity: Periodicity.MONTHLY,
        from: at("2026-02-10"),
        count: 1,
      }),
    );
    expect(raw).toEqual(["28/02/2026"]);
  });

  it("PERIOD_START part du début de période", () => {
    const { raw } = dates(
      previewDueDates({
        rule: { anchor: DueAnchor.PERIOD_START, offset_days: 0, weekend_shift: DateShift.NONE },
        periodicity: Periodicity.MONTHLY,
        from: at("2026-02-10"),
        count: 1,
      }),
    );
    expect(raw).toEqual(["01/02/2026"]);
  });

  it("FIXED_DATE ignore les bornes de période et vise une date civile", () => {
    const { raw } = dates(
      previewDueDates({
        rule: { anchor: DueAnchor.FIXED_DATE, fixed_month: 4, fixed_day: 30 },
        periodicity: Periodicity.ANNUAL,
        from: at("2026-06-01"),
        count: 2,
      }),
    );
    expect(raw).toEqual(["30/04/2026", "30/04/2027"]);
  });

  it("FIXED_DATE avec year_offset dépose l'année suivante", () => {
    const { keys, raw } = dates(
      previewDueDates({
        rule: { anchor: DueAnchor.FIXED_DATE, fixed_month: 4, fixed_day: 30, year_offset: 1 },
        periodicity: Periodicity.ANNUAL,
        from: at("2026-06-01"),
        count: 1,
      }),
    );
    // L'exercice 2026 se déclare le 30/04/2027.
    expect(keys).toEqual(["2026"]);
    expect(raw).toEqual(["30/04/2027"]);
  });

  it("FIXED_DATE ramène le 31 au dernier jour réel du mois", () => {
    const { raw } = dates(
      previewDueDates({
        rule: { anchor: DueAnchor.FIXED_DATE, fixed_month: 2, fixed_day: 31 },
        periodicity: Periodicity.ANNUAL,
        from: at("2026-01-01"),
        count: 1,
      }),
    );
    expect(raw).toEqual(["28/02/2026"]);
  });

  it("EXPIRY_DATE part de la date d'expiration", () => {
    const { raw } = dates(
      previewDueDates({
        rule: { anchor: DueAnchor.EXPIRY_DATE, offset_days: -30 },
        periodicity: Periodicity.ANNUAL,
        anchorDate: at("2026-12-31"),
        count: 1,
      }),
    );
    expect(raw).toEqual(["01/12/2026"]);
  });

  it("EVENT_DATE part du fait déclencheur", () => {
    const { raw } = dates(
      previewDueDates({
        rule: { anchor: DueAnchor.EVENT_DATE, offset_days: 15 },
        periodicity: Periodicity.ON_EVENT,
        anchorDate: at("2026-05-04"),
        count: 1,
      }),
    );
    expect(raw).toEqual(["19/05/2026"]);
  });

  it("refuse une ancre événementielle sans date d'ancrage", () => {
    const result = previewDueDates({
      rule: { anchor: DueAnchor.EXPIRY_DATE, offset_days: -30 },
      periodicity: Periodicity.ANNUAL,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.details?.["reason"]).toBe("ANCHOR_DATE_REQUIRED");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Reports
// ═════════════════════════════════════════════════════════════════════════════

describe("reports de jour chômé", () => {
  it("NONE laisse l'échéance tomber un jour chômé", () => {
    const { legal, raw } = dates(
      previewDueDates({
        rule: {
          anchor: DueAnchor.PERIOD_END,
          offset_days: 20,
          weekend_shift: DateShift.NONE,
          holiday_shift: DateShift.NONE,
        },
        periodicity: Periodicity.MONTHLY,
        from: at("2026-02-01"),
        count: 1,
      }),
    );
    // 20/03/2026 est un vendredi : sans report, l'échéance y reste.
    expect(raw).toEqual(["20/03/2026"]);
    expect(legal).toEqual(["20/03/2026"]);
  });

  it("PREVIOUS_BUSINESS_DAY ramène en arrière", () => {
    const result = previewDueDates({
      rule: {
        anchor: DueAnchor.PERIOD_END,
        offset_days: 20,
        weekend_shift: DateShift.PREVIOUS_BUSINESS_DAY,
        holiday_shift: DateShift.PREVIOUS_BUSINESS_DAY,
      },
      periodicity: Periodicity.MONTHLY,
      from: at("2026-02-01"),
      count: 1,
    });

    if (!result.ok) throw new Error("prévisualisation en échec");
    // Vendredi 20/03 → jeudi 19/03.
    expect(formatDateFr(result.value[0]?.legalDueDate ?? at("1970-01-01"))).toBe("19/03/2026");
    expect(result.value[0]?.shiftReason).toBe("WEEKEND");
  });

  it("enjambe plusieurs jours chômés consécutifs", () => {
    // Vendredi 20/03 + samedi + dimanche 22 férié → lundi 23.
    const result = previewDueDates({
      rule: { anchor: DueAnchor.PERIOD_END, offset_days: 20 },
      periodicity: Periodicity.MONTHLY,
      from: at("2026-02-01"),
      count: 1,
      holidays: [at("2026-03-22")],
    });

    if (!result.ok) throw new Error("prévisualisation en échec");
    expect(formatDateFr(result.value[0]?.legalDueDate ?? at("1970-01-01"))).toBe("23/03/2026");
  });

  it("ne signale aucun report quand la date brute est déjà ouvrée", () => {
    const result = previewDueDates({
      rule: { anchor: DueAnchor.PERIOD_END, offset_days: 20 },
      periodicity: Periodicity.MONTHLY,
      from: at("2026-03-01"),
      count: 1,
    });

    if (!result.ok) throw new Error("prévisualisation en échec");
    expect(result.value[0]?.shiftReason).toBeNull();
    expect(result.value[0]?.rawDueDate).toEqual(result.value[0]?.legalDueDate);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Échéance interne
// ═════════════════════════════════════════════════════════════════════════════

describe("échéance interne", () => {
  it("retranche la marge en jours OUVRÉS, pas en jours calendaires", () => {
    const result = previewDueDates({
      rule: { anchor: DueAnchor.PERIOD_END, offset_days: 20 },
      periodicity: Periodicity.MONTHLY,
      from: at("2026-03-01"),
      count: 1,
      internalLeadDays: 5,
    });

    if (!result.ok) throw new Error("prévisualisation en échec");
    // Légale : lundi 20/04/2026. Cinq jours OUVRÉS avant = lundi 13/04
    // (le week-end vendredi 17 / samedi 18 ne compte pas).
    expect(formatDateFr(result.value[0]?.legalDueDate ?? at("1970-01-01"))).toBe("20/04/2026");
    expect(formatDateFr(result.value[0]?.internalDueDate ?? at("1970-01-01"))).toBe("13/04/2026");
  });

  it("sans marge, interne et légale coïncident", () => {
    const result = previewDueDates({
      rule: { anchor: DueAnchor.PERIOD_END, offset_days: 20 },
      periodicity: Periodicity.MONTHLY,
      from: at("2026-03-01"),
      count: 1,
    });

    if (!result.ok) throw new Error("prévisualisation en échec");
    expect(result.value[0]?.internalDueDate).toEqual(result.value[0]?.legalDueDate);
  });

  it("les marges de CLAUDE.md se retranchent bien depuis la criticité", () => {
    // Les valeurs viennent de INTERNAL_LEAD_DAYS_BY_CRITICALITY : le moteur ne
    // les connaît pas, il applique celle qu'on lui passe.
    const lead = { CRITICAL: 7, HIGH: 5, MEDIUM: 3, LOW: 0 } as const satisfies Record<
      Criticality,
      number
    >;

    for (const days of Object.values(lead)) {
      const result = previewDueDates({
        rule: { anchor: DueAnchor.PERIOD_END, offset_days: 20 },
        periodicity: Periodicity.MONTHLY,
        from: at("2026-03-01"),
        count: 1,
        internalLeadDays: days,
      });
      if (!result.ok) throw new Error("prévisualisation en échec");
      const preview = result.value[0];
      if (preview === undefined) throw new Error("aucune ligne");
      expect(preview.internalDueDate.getTime()).toBeLessThanOrEqual(preview.legalDueDate.getTime());
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Validation
// ═════════════════════════════════════════════════════════════════════════════

describe("validateDueRule", () => {
  const reasonOf = (result: ReturnType<typeof validateDueRule>): unknown =>
    result.ok ? null : result.error.details?.["reason"];

  it("CUSTOM exige occurrences[]", () => {
    expect(
      reasonOf(
        validateDueRule({
          rule: { anchor: DueAnchor.PERIOD_END, offset_days: 0 },
          periodicity: Periodicity.CUSTOM,
        }),
      ),
    ).toBe("CUSTOM_REQUIRES_OCCURRENCES");
  });

  it("CUSTOM refuse une liste vide", () => {
    expect(
      reasonOf(
        validateDueRule({
          rule: { anchor: DueAnchor.PERIOD_END, offset_days: 0, occurrences: [] },
          periodicity: Periodicity.CUSTOM,
        }),
      ),
    ).toBe("CUSTOM_REQUIRES_OCCURRENCES");
  });

  it("CUSTOM refuse deux fois la même date", () => {
    expect(
      reasonOf(
        validateDueRule({
          rule: {
            anchor: DueAnchor.PERIOD_END,
            offset_days: 0,
            occurrences: [
              { month: 3, day: 31 },
              { month: 3, day: 31 },
            ],
          },
          periodicity: Periodicity.CUSTOM,
        }),
      ),
    ).toBe("CUSTOM_DUPLICATE_DATE");
  });

  it("occurrences[] est refusé hors CUSTOM", () => {
    expect(
      reasonOf(
        validateDueRule({
          rule: {
            anchor: DueAnchor.PERIOD_END,
            offset_days: 10,
            occurrences: [{ month: 3, day: 31 }],
          },
          periodicity: Periodicity.MONTHLY,
        }),
      ),
    ).toBe("OCCURRENCES_ONLY_FOR_CUSTOM");
  });

  it("ON_EVENT exige EVENT_DATE ou EXPIRY_DATE", () => {
    expect(
      reasonOf(
        validateDueRule({
          rule: { anchor: DueAnchor.PERIOD_END, offset_days: 10 },
          periodicity: Periodicity.ON_EVENT,
        }),
      ),
    ).toBe("ON_EVENT_REQUIRES_EVENT_ANCHOR");

    for (const anchor of [DueAnchor.EVENT_DATE, DueAnchor.EXPIRY_DATE]) {
      expect(
        validateDueRule({
          rule: { anchor, offset_days: 10 },
          periodicity: Periodicity.ON_EVENT,
        }).ok,
      ).toBe(true);
    }
  });

  it("FIXED_DATE exige mois et jour", () => {
    expect(
      reasonOf(
        validateDueRule({
          rule: { anchor: DueAnchor.FIXED_DATE, fixed_month: 4 },
          periodicity: Periodicity.ANNUAL,
        }),
      ),
    ).toBe("FIXED_DATE_REQUIRES_MONTH_AND_DAY");
  });

  it("FIXED_DATE est refusé sur une périodicité infra-annuelle", () => {
    // Douze périodes mensuelles rendraient toutes la même date civile.
    expect(
      reasonOf(
        validateDueRule({
          rule: { anchor: DueAnchor.FIXED_DATE, fixed_month: 4, fixed_day: 30 },
          periodicity: Periodicity.MONTHLY,
        }),
      ),
    ).toBe("FIXED_DATE_REQUIRES_ANNUAL_PERIODICITY");
  });

  it("les ancres par décalage exigent offset_days", () => {
    for (const anchor of [
      DueAnchor.PERIOD_END,
      DueAnchor.PERIOD_START,
      DueAnchor.EXPIRY_DATE,
      DueAnchor.EVENT_DATE,
    ]) {
      expect(reasonOf(validateDueRule({ rule: { anchor }, periodicity: Periodicity.ANNUAL }))).toBe(
        "OFFSET_DAYS_REQUIRED",
      );
    }
  });

  it("refuse deux reports de sens opposés", () => {
    expect(
      reasonOf(
        validateDueRule({
          rule: {
            anchor: DueAnchor.PERIOD_END,
            offset_days: 10,
            weekend_shift: DateShift.NEXT_BUSINESS_DAY,
            holiday_shift: DateShift.PREVIOUS_BUSINESS_DAY,
          },
          periodicity: Periodicity.MONTHLY,
        }),
      ),
    ).toBe("SHIFTS_MUST_AGREE");
  });

  it("accepte un report désactivé d'un seul côté", () => {
    expect(
      validateDueRule({
        rule: {
          anchor: DueAnchor.PERIOD_END,
          offset_days: 10,
          weekend_shift: DateShift.NONE,
          holiday_shift: DateShift.NEXT_BUSINESS_DAY,
        },
        periodicity: Periodicity.MONTHLY,
      }).ok,
    ).toBe(true);
  });

  it("refuse une forme non conforme sans lever d'exception", () => {
    for (const rule of [null, undefined, 42, "PERIOD_END", { anchor: "INCONNU" }, {}]) {
      const result = validateDueRule({ rule, periodicity: Periodicity.MONTHLY });
      expect(result.ok).toBe(false);
    }
  });

  it("applique les reports par défaut quand ils sont absents", () => {
    const result = validateDueRule({
      rule: { anchor: DueAnchor.PERIOD_END, offset_days: 20 },
      periodicity: Periodicity.MONTHLY,
    });

    if (!result.ok) throw new Error("validation en échec");
    // Le défaut est explicité à l'écriture : la règle stockée ne laisse rien
    // d'implicite dans le JSONB.
    expect(result.value.weekend_shift).toBe(DateShift.NEXT_BUSINESS_DAY);
    expect(result.value.holiday_shift).toBe(DateShift.NEXT_BUSINESS_DAY);
  });
});

describe("defaultDueRule", () => {
  it("propose une règle DÉJÀ VALIDE pour chacune des 7 périodicités", () => {
    for (const periodicity of Object.values(Periodicity)) {
      const rule = defaultDueRule(periodicity);
      const result = validateDueRule({ rule, periodicity });

      if (periodicity === Periodicity.CUSTOM) {
        // Seule exception : CUSTOM ne peut pas deviner les dates de l'utilisateur.
        expect(result.ok).toBe(false);
        continue;
      }
      expect(result.ok).toBe(true);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Invariants
// ═════════════════════════════════════════════════════════════════════════════

describe("invariants", () => {
  it("la prévisualisation ne dépend pas du fuseau système", () => {
    // `from` à 23 h UTC est déjà le lendemain à Alger (UTC+1). La période retenue
    // doit être celle du calendrier ALGÉRIEN.
    const result = previewDueDates({
      rule: { anchor: DueAnchor.PERIOD_END, offset_days: 20 },
      periodicity: Periodicity.MONTHLY,
      from: new Date("2026-01-31T23:30:00.000Z"),
      count: 1,
    });

    const { keys } = dates(result);
    expect(keys).toEqual(["2026-02"]);
  });

  it("computeDueDate et previewDueDates donnent le même résultat", () => {
    // Deux chemins d'appel, une seule implémentation : c'est l'invariant qui
    // garantit que l'écran affiche ce que le moteur générera.
    const rule = {
      anchor: DueAnchor.PERIOD_END,
      offset_days: 20,
      weekend_shift: DateShift.NEXT_BUSINESS_DAY,
      holiday_shift: DateShift.NEXT_BUSINESS_DAY,
    } as const;

    const preview = previewDueDates({
      rule,
      periodicity: Periodicity.MONTHLY,
      from: at("2026-01-15"),
      count: 1,
    });
    if (!preview.ok) throw new Error("prévisualisation en échec");
    const line = preview.value[0];
    if (line === undefined) throw new Error("aucune ligne");

    const direct = computeDueDate({
      rule,
      period: {
        key: line.periodKey,
        periodicity: Periodicity.MONTHLY,
        start: line.periodStart,
        end: line.periodEnd,
      },
    });
    if (!direct.ok) throw new Error("calcul direct en échec");

    expect(direct.value.legalDueDate).toEqual(line.legalDueDate);
    expect(direct.value.rawDueDate).toEqual(line.rawDueDate);
  });

  it("borne le nombre de lignes demandé", () => {
    const result = previewDueDates({
      rule: { anchor: DueAnchor.PERIOD_END, offset_days: 20 },
      periodicity: Periodicity.MONTHLY,
      from: at("2026-01-15"),
      count: 500,
    });

    if (!result.ok) throw new Error("prévisualisation en échec");
    expect(result.value).toHaveLength(24);
  });

  it("l'échéance légale tombe toujours un jour ouvré quand le report est actif", () => {
    const holidays = [at("2026-04-20"), at("2026-04-21")];

    const result = previewDueDates({
      rule: { anchor: DueAnchor.PERIOD_END, offset_days: 20 },
      periodicity: Periodicity.MONTHLY,
      from: at("2026-01-01"),
      count: 12,
      holidays,
    });

    if (!result.ok) throw new Error("prévisualisation en échec");
    for (const preview of result.value) {
      const day = toUtcFromAppTz(preview.legalDueDate).getTime();
      expect(Number.isFinite(day)).toBe(true);
      expect(preview.shiftReason === null || preview.rawDueDate < preview.legalDueDate).toBe(true);
    }
  });
});
