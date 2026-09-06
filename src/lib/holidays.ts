/**
 * CALENDRIER DES JOURS FÉRIÉS — projection par année.
 *
 * ⚠️ CE MODULE EXISTE PARCE QUE `is_recurring` NE SERVAIT À RIEN.
 *
 * La colonne était lue, affichée dans l'écran d'administration, et cochée par
 * les administrateurs. Le moteur d'échéance, lui, ne recevait qu'une liste de
 * DATES EXACTES : `select holiday_date from holidays`. Une fête marquée
 * « récurrente » en 2026 ne protégeait donc en rien 2027 — et comme le
 * calendrier ne contenait que 2026, TOUTE échéance calculée en 2027 ignorait
 * les jours chômés.
 *
 * Le défaut ne produisait ni erreur, ni message, ni test rouge. Seulement une
 * date fausse qui a l'air juste — c'est-à-dire exactement ce que cette
 * plateforme existe pour empêcher.
 *
 * ⚠️ DEUX NATURES DE JOURS FÉRIÉS, ET ELLES NE SE MÉLANGENT PAS.
 *
 *   • CIVILS, à date fixe — 1er janvier, Yennayer, 1er mai, 5 juillet,
 *     1er novembre. Ils reviennent au même jour du même mois, chaque année. On
 *     les saisit UNE FOIS, marqués récurrents, et ce module les projette.
 *
 *   • RELIGIEUX — Aïd el-Fitr, Aïd el-Adha, Awal Moharem, Achoura, Mawlid
 *     Ennabaoui. Ils suivent le calendrier hégirien et sont fixés CHAQUE ANNÉE
 *     PAR DÉCRET. Ils ne se calculent pas : toute formule serait fausse une
 *     année sur deux, et fausse en silence. Ils se saisissent comme des dates
 *     EXACTES, année par année, jamais récurrentes.
 *
 * Conséquence directe : l'absence de fête religieuse pour une année donnée n'est
 * JAMAIS un état normal. C'est toujours un oubli — et c'est pourquoi il est
 * signalé plutôt que toléré.
 */

import { toUtcFromAppTz } from "@/lib/dates";

/** Une ligne du calendrier, telle que la base la porte. */
export interface HolidayEntry {
  /** Jour civil, `AAAA-MM-JJ`. Pour une récurrente, l'année est celle de la saisie. */
  readonly date: string;
  readonly isRecurring: boolean;
}

/** Midi d'Alger pour une date civile : à l'abri de tout basculement de fuseau. */
function atAlgiersNoon(year: number, month: number, day: number): Date {
  return toUtcFromAppTz(new Date(year, month - 1, day, 12, 0, 0, 0));
}

interface Parsed {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

function parseIsoDay(day: string): Parsed | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (match === null) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  if (month < 1 || month > 12 || date < 1 || date > 31) return null;

  return { year, month, day: date };
}

/** Une date récurrente au 29 février n'existe pas les années non bissextiles. */
function existsInYear(month: number, day: number, year: number): boolean {
  const probe = new Date(year, month - 1, day, 12, 0, 0, 0);
  return probe.getMonth() === month - 1 && probe.getDate() === day;
}

/**
 * Jours chômés applicables à UNE année donnée.
 *
 * Réunit deux ensembles : les dates récurrentes PROJETÉES sur cette année, et
 * les dates exactes qui lui appartiennent déjà.
 *
 * ⚠️ LE 29 FÉVRIER RÉCURRENT EST OMIS les années non bissextiles, et non reporté
 * au 28. Reporter reviendrait à inventer un jour chômé un jour où il n'y en a
 * pas — et un jour chômé inventé décale une échéance vers l'avant, donc fait
 * croire à une marge qui n'existe pas. Omettre est le seul choix qui ne ment
 * pas. (Aucune fête algérienne ne tombe le 29 février ; la règle existe pour que
 * la saisie d'une date impossible n'ait pas de conséquence silencieuse.)
 */
export function expandHolidays(entries: readonly HolidayEntry[], year: number): Date[] {
  const dates: Date[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const parsed = parseIsoDay(entry.date);
    // Une ligne illisible est ignorée plutôt que devinée : elle ne peut pas
    // rendre une échéance fausse, seulement laisser un jour ouvré de trop —
    // l'erreur qui se voit, pas celle qui se cache.
    if (parsed === null) continue;

    if (entry.isRecurring) {
      if (!existsInYear(parsed.month, parsed.day, year)) continue;
      const key = `${String(year)}-${String(parsed.month)}-${String(parsed.day)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dates.push(atAlgiersNoon(year, parsed.month, parsed.day));
      continue;
    }

    if (parsed.year !== year) continue;
    const key = `${String(parsed.year)}-${String(parsed.month)}-${String(parsed.day)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dates.push(atAlgiersNoon(parsed.year, parsed.month, parsed.day));
  }

  return dates;
}

/**
 * Jours chômés de l'année demandée ET de ses deux voisines.
 *
 * ⚠️ LES VOISINES NE SONT PAS UNE PRÉCAUTION DÉCORATIVE. Un report franchit les
 * bornes d'année : le 31 décembre chômé renvoie au 1er janvier, lui-même chômé,
 * qui renvoie au 2. Et l'échéance INTERNE se calcule en remontant de plusieurs
 * jours ouvrés depuis l'échéance légale — un 10 janvier remonte en décembre.
 * N'étendre que l'année de l'échéance rendrait ces deux cas faux, et faux
 * précisément aux dates les plus chargées du calendrier.
 */
export function expandHolidaysAround(entries: readonly HolidayEntry[], year: number): Date[] {
  return [
    ...expandHolidays(entries, year - 1),
    ...expandHolidays(entries, year),
    ...expandHolidays(entries, year + 1),
  ];
}

/**
 * Années pour lesquelles le calendrier porte au moins une date EXACTE.
 *
 * ⚠️ LES RÉCURRENTES NE COMPTENT PAS, et c'est tout l'intérêt de cette fonction.
 * Elles couvrent toutes les années par construction : les inclure ferait
 * déclarer 2027 « couverte » alors qu'aucune fête religieuse n'y est saisie —
 * c'est-à-dire produirait exactement le silence qu'on cherche à rompre.
 */
export function yearsWithExactHolidays(entries: readonly HolidayEntry[]): ReadonlySet<number> {
  const years = new Set<number>();
  for (const entry of entries) {
    if (entry.isRecurring) continue;
    const parsed = parseIsoDay(entry.date);
    if (parsed !== null) years.add(parsed.year);
  }
  return years;
}

/**
 * Années qu'un horizon de génération va toucher, bornes comprises.
 *
 * On ajoute l'année suivante : une période de décembre échoit en janvier, et
 * c'est le calendrier de janvier qui décide.
 */
export function yearsCoveredBy(from: Date, horizonMonths: number): number[] {
  const start = from.getUTCFullYear();
  const end = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + horizonMonths, 1),
  ).getUTCFullYear();

  const years: number[] = [];
  for (let year = start; year <= end + 1; year += 1) years.push(year);
  return years;
}
