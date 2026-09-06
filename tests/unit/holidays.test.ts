import { describe, expect, it } from "vitest";

import { DateShift, DueAnchor, Periodicity } from "@/config/constants";
import { toAppTz, toUtcFromAppTz } from "@/lib/dates";
import {
  expandHolidays,
  expandHolidaysAround,
  yearsCoveredBy,
  yearsWithExactHolidays,
  type HolidayEntry,
} from "@/lib/holidays";
import { computeDueDate } from "@/services/scheduling/due-dates";

/**
 * LE CALENDRIER DES JOURS FÉRIÉS, ET LA PROJECTION QUI MANQUAIT.
 *
 * ⚠️ CE FICHIER GARDE LE DÉFAUT LE PLUS DANGEREUX RENCONTRÉ SUR CE PROJET.
 *
 * `is_recurring` était lue, affichée, cochée par les administrateurs — et sans
 * effet : le moteur recevait `select holiday_date`, donc des dates exactes. Une
 * fête marquée récurrente en 2026 ne protégeait rien en 2027, et comme le
 * calendrier ne contenait que 2026, TOUTE échéance calculée en 2027 ignorait les
 * jours chômés.
 *
 * Aucune erreur, aucun message, aucun test rouge. Seulement une date fausse qui
 * a l'air juste — c'est-à-dire exactement ce que cette plateforme existe pour
 * empêcher.
 *
 * ⚠️ Le premier test de la dernière section ÉCHOUE si l'on rétablit la lecture
 * par dates exactes. C'est lui qui tient la correction.
 */

/** Minuit d'Alger, midi en réalité : à l'abri de tout basculement de fuseau. */
function alger(year: number, month: number, day: number): Date {
  return toUtcFromAppTz(new Date(year, month - 1, day, 12, 0, 0, 0));
}

function jour(instant: Date): string {
  const zoned = toAppTz(instant);
  return [
    String(zoned.getFullYear()),
    String(zoned.getMonth() + 1).padStart(2, "0"),
    String(zoned.getDate()).padStart(2, "0"),
  ].join("-");
}

function jours(dates: readonly Date[]): string[] {
  return dates.map(jour).sort();
}

/** Les cinq fêtes civiles algériennes, telles que le référentiel les porte. */
const CIVILES: HolidayEntry[] = [
  { date: "2026-01-01", isRecurring: true },
  { date: "2026-01-12", isRecurring: true },
  { date: "2026-05-01", isRecurring: true },
  { date: "2026-07-05", isRecurring: true },
  { date: "2026-11-01", isRecurring: true },
];

// ═════════════════════════════════════════════════════════════════════════════

describe("expandHolidays — projection par année", () => {
  it("projette les récurrentes sur l'année DEMANDÉE, pas celle de la saisie", () => {
    /*
     * ⚠️ LE CŒUR DE LA CORRECTION. Les cinq fêtes sont saisies avec un millésime
     * 2026 — c'est ce que porte la colonne — et doivent valoir pour 2027, 2030,
     * n'importe quelle année. Sans cette projection, 2027 n'avait aucun jour
     * chômé.
     */
    expect(jours(expandHolidays(CIVILES, 2027))).toEqual([
      "2027-01-01",
      "2027-01-12",
      "2027-05-01",
      "2027-07-05",
      "2027-11-01",
    ]);
  });

  it("ne retient une date EXACTE que pour son année", () => {
    /*
     * Les fêtes religieuses sont fixées par décret, année par année. Les
     * projeter serait inventer une règle réglementaire — et le faire une fois
     * suffirait à rendre le calendrier faux sans que personne ne le voie.
     */
    const religieuses: HolidayEntry[] = [
      { date: "2026-03-20", isRecurring: false },
      { date: "2027-03-09", isRecurring: false },
    ];

    expect(jours(expandHolidays(religieuses, 2026))).toEqual(["2026-03-20"]);
    expect(jours(expandHolidays(religieuses, 2027))).toEqual(["2027-03-09"]);
    expect(expandHolidays(religieuses, 2028)).toEqual([]);
  });

  it("réunit les deux natures pour une même année", () => {
    const calendrier = [...CIVILES, { date: "2027-03-09", isRecurring: false }];
    expect(jours(expandHolidays(calendrier, 2027))).toContain("2027-03-09");
    expect(jours(expandHolidays(calendrier, 2027))).toContain("2027-01-01");
  });

  it("ne double pas une date présente sous les deux formes", () => {
    // Un 1er janvier saisi à la main EN PLUS de la récurrente ne doit pas
    // produire deux entrées : le report compterait deux fois le même jour.
    const calendrier: HolidayEntry[] = [
      { date: "2026-01-01", isRecurring: true },
      { date: "2027-01-01", isRecurring: false },
    ];
    expect(expandHolidays(calendrier, 2027)).toHaveLength(1);
  });

  it("OMET un 29 février récurrent les années non bissextiles", () => {
    /*
     * ⚠️ OMIS, ET NON REPORTÉ AU 28. Reporter inventerait un jour chômé un jour
     * où il n'y en a pas — et un jour chômé inventé décale l'échéance vers
     * l'avant, donc fait croire à une marge qui n'existe pas.
     */
    const bissextile: HolidayEntry[] = [{ date: "2024-02-29", isRecurring: true }];

    expect(jours(expandHolidays(bissextile, 2028))).toEqual(["2028-02-29"]);
    expect(expandHolidays(bissextile, 2027)).toEqual([]);
    expect(expandHolidays(bissextile, 2026)).toEqual([]);
  });

  it("ignore une ligne illisible plutôt que de la deviner", () => {
    const abimé: HolidayEntry[] = [
      { date: "pas-une-date", isRecurring: true },
      { date: "2026-13-45", isRecurring: false },
      { date: "2027-01-01", isRecurring: false },
    ];
    expect(jours(expandHolidays(abimé, 2027))).toEqual(["2027-01-01"]);
  });

  it("les années voisines sont incluses, parce qu'un report les franchit", () => {
    const autour = jours(expandHolidaysAround(CIVILES, 2027));
    expect(autour).toContain("2026-11-01");
    expect(autour).toContain("2027-01-01");
    expect(autour).toContain("2028-01-01");
  });
});

describe("couverture du calendrier", () => {
  it("les récurrentes NE COMPTENT PAS comme couverture d'une année", () => {
    /*
     * ⚠️ C'est tout l'intérêt de la mesure. Les récurrentes couvrent toutes les
     * années par construction : les compter ferait déclarer 2027 « couverte »
     * alors qu'aucune fête religieuse n'y est saisie — c'est-à-dire produirait
     * exactement le silence qu'on cherche à rompre.
     */
    expect(yearsWithExactHolidays(CIVILES).size).toBe(0);

    const avecReligieuses = [...CIVILES, { date: "2026-03-20", isRecurring: false }];
    expect([...yearsWithExactHolidays(avecReligieuses)]).toEqual([2026]);
  });

  it("l'horizon couvre l'année suivante : une période de décembre échoit en janvier", () => {
    expect(yearsCoveredBy(new Date("2026-11-01T00:00:00Z"), 12)).toEqual([2026, 2027, 2028]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe("le calcul d'échéance consulte l'année de l'ÉCHÉANCE", () => {
  const periode = (annee: number, mois: number) => ({
    key: `${String(annee)}-${String(mois).padStart(2, "0")}`,
    periodicity: Periodicity.MONTHLY,
    start: alger(annee, mois, 1),
    end: alger(annee, mois, new Date(annee, mois, 0).getDate()),
  });

  it("⚠️ une fête RÉCURRENTE saisie en 2026 décale une échéance de 2027", () => {
    /*
     * ⚠️ CE TEST ÉCHOUE SI L'ON RÉTABLIT LA LECTURE PAR DATES EXACTES. Sans
     * projection, le calendrier ne contient que « 2026-05-01 » ; l'échéance du
     * 1er mai 2027 tombe alors un jour réputé ouvré, et la date rendue est le
     * 1er mai — fausse, et d'apparence parfaitement normale.
     *
     * Le 1er mai 2027 est un samedi : jour de week-end en Algérie. Le report
     * franchit donc le férié ET le week-end, et atterrit le dimanche 2 —
     * premier jour ouvré.
     */
    const resultat = computeDueDate({
      rule: {
        anchor: DueAnchor.PERIOD_END,
        offset_days: 0,
        // Les deux directives sont EXPLICITES : c'est le report lui-même qu'on
        // éprouve, le laisser à un défaut le rendrait dépendant d'un ailleurs.
        weekend_shift: DateShift.NEXT_BUSINESS_DAY,
        holiday_shift: DateShift.NEXT_BUSINESS_DAY,
      },
      period: periode(2027, 4),
      holidays: CIVILES,
    });

    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(jour(resultat.value.rawDueDate)).toBe("2027-04-30");

    // Le 30 avril 2027 est un vendredi — premier jour du week-end algérien.
    // Report au samedi 1er mai, chômé, puis au dimanche 2 : jour ouvré.
    expect(jour(resultat.value.legalDueDate)).toBe("2027-05-02");
    expect(resultat.value.shiftReason).not.toBeNull();
  });

  it("⚠️ une période de DÉCEMBRE 2026 échéant en JANVIER 2027 consulte 2027", () => {
    /*
     * Le cas qui donne son nom au défaut. La période appartient à 2026 ;
     * l'échéance tombe le 1er janvier 2027. Consulter le calendrier de la
     * PÉRIODE — ce que faisait le code — revenait à chercher le 1er janvier
     * 2027 dans une liste qui ne contenait que des dates de 2026.
     */
    const resultat = computeDueDate({
      rule: {
        anchor: DueAnchor.PERIOD_END,
        offset_days: 1,
        // Les deux directives sont EXPLICITES : c'est le report lui-même qu'on
        // éprouve, le laisser à un défaut le rendrait dépendant d'un ailleurs.
        weekend_shift: DateShift.NEXT_BUSINESS_DAY,
        holiday_shift: DateShift.NEXT_BUSINESS_DAY,
      },
      period: periode(2026, 12),
      holidays: CIVILES,
    });

    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(jour(resultat.value.rawDueDate)).toBe("2027-01-01");
    // 1er janvier chômé, 2 janvier samedi : report au dimanche 3.
    expect(jour(resultat.value.legalDueDate)).toBe("2027-01-03");
    expect(resultat.value.shiftReason).toBe("HOLIDAY");
  });

  it("une fête religieuse suivie du week-end produit un DOUBLE report", () => {
    /*
     * ⚠️ Le week-end algérien est vendredi-samedi. Une fête tombant un jeudi
     * repousse au vendredi — chômé —, puis au samedi — chômé —, et n'atterrit
     * que le dimanche. Trois jours de décalage sur une échéance fiscale, qu'un
     * calendrier incomplet effacerait purement et simplement.
     */
    const religieuse: HolidayEntry[] = [{ date: "2027-04-29", isRecurring: false }];

    const resultat = computeDueDate({
      rule: {
        anchor: DueAnchor.PERIOD_END,
        offset_days: -1,
        // Les deux directives sont EXPLICITES : c'est le report lui-même qu'on
        // éprouve, le laisser à un défaut le rendrait dépendant d'un ailleurs.
        weekend_shift: DateShift.NEXT_BUSINESS_DAY,
        holiday_shift: DateShift.NEXT_BUSINESS_DAY,
      },
      period: periode(2027, 4),
      holidays: religieuse,
    });

    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    // 29 avril 2027 : un jeudi, déclaré chômé.
    expect(jour(resultat.value.rawDueDate)).toBe("2027-04-29");
    expect(jour(resultat.value.legalDueDate)).toBe("2027-05-02");
    expect(resultat.value.shiftReason).toBe("HOLIDAY");
  });

  it("l'échéance INTERNE remonte dans l'année précédente sans perdre le calendrier", () => {
    /*
     * La marge interne se compte en jours OUVRÉS, à rebours. Depuis un 3 janvier,
     * quinze jours ouvrés remontent en décembre : si l'expansion ne couvrait que
     * l'année de l'échéance, les fêtes de décembre disparaîtraient du calcul.
     */
    const resultat = computeDueDate({
      rule: {
        anchor: DueAnchor.PERIOD_END,
        offset_days: 1,
        // Les deux directives sont EXPLICITES : c'est le report lui-même qu'on
        // éprouve, le laisser à un défaut le rendrait dépendant d'un ailleurs.
        weekend_shift: DateShift.NEXT_BUSINESS_DAY,
        holiday_shift: DateShift.NEXT_BUSINESS_DAY,
      },
      period: periode(2026, 12),
      holidays: [...CIVILES, { date: "2026-12-24", isRecurring: false }],
      internalLeadDays: 15,
    });

    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(jour(resultat.value.internalDueDate).startsWith("2026-12")).toBe(true);
  });
});
