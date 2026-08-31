/**
 * ⚠️ MODULE CRITIQUE — toute la logique d'échéance en dépend.
 *
 * Deux représentations coexistent, ne jamais les confondre :
 *
 *  • **Instant** — une `Date` normale, position absolue sur la ligne du temps.
 *    C'est ce qui est stocké (`timestamptz`) et transporté. Toutes les fonctions
 *    publiques de ce module prennent un instant et rendent un instant.
 *
 *  • **Date zonée** — une `Date` dont les accesseurs LOCAUX (`getHours()`, …)
 *    restituent l'heure murale d'Alger. C'est un intermédiaire de calcul produit
 *    par `toAppTz()` / `nowInAppTz()`. **Ne jamais la persister ni la sérialiser** :
 *    son `getTime()` est décalé. Repasser par `toUtcFromAppTz()` avant stockage.
 *
 * L'Algérie est à UTC+1 toute l'année (aucun changement d'heure), ce qui rend
 * l'aller-retour `toUtcFromAppTz(toAppTz(x)) === x` exact.
 */

import {
  addDays,
  addMonths,
  addYears,
  differenceInCalendarDays,
  endOfDay,
  endOfMonth,
  endOfQuarter,
  endOfYear,
  format,
  setMonth,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfYear,
} from "date-fns";
import { fr } from "date-fns/locale";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

import { DateShift, Periodicity } from "@/config/constants";
import { AppError } from "@/lib/errors";

export const APP_TIMEZONE = "Africa/Algiers";

// ─── Semaine ouvrée ──────────────────────────────────────────────────────────

/** Indices `Date.prototype.getDay()`. */
export const WeekDay = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
} as const;

export type WeekDay = (typeof WeekDay)[keyof typeof WeekDay];

/**
 * Week-end algérien : vendredi et samedi.
 * L'algorithme jours ouvrés lit cette constante — il ne connaît aucun jour en dur.
 */
export const WEEKEND_DAYS: readonly WeekDay[] = [WeekDay.FRIDAY, WeekDay.SATURDAY];

// ─── Conversions ─────────────────────────────────────────────────────────────

/**
 * Instant courant, exprimé en date zonée Alger.
 *
 * Seul point du code applicatif autorisé à lire l'horloge système : toute autre
 * fonction ayant besoin de « maintenant » passe par ici, ce qui rend l'ensemble
 * testable avec `vi.setSystemTime()`.
 */
export function nowInAppTz(): Date {
  return toZonedTime(new Date(), APP_TIMEZONE);
}

/** Instant → date zonée Alger (intermédiaire de calcul, jamais persisté). */
export function toAppTz(instant: Date): Date {
  return toZonedTime(instant, APP_TIMEZONE);
}

/** Date zonée Alger → instant réel. À appeler avant tout stockage. */
export function toUtcFromAppTz(zoned: Date): Date {
  return fromZonedTime(zoned, APP_TIMEZONE);
}

/**
 * Construit une date zonée à partir de composantes calendaires algériennes.
 *
 * Passe par une chaîne d'heure murale plutôt que par `new Date(y, m, d)` :
 * ce dernier interpréterait les composantes dans le fuseau de la machine, qui
 * peut avoir un saut d'heure d'été à minuit (Asia/Beirut, America/Santiago…).
 * `fromZonedTime` sur une chaîne ne dépend d'aucun fuseau système.
 */
function zonedDateFromParts(year: number, monthIndex: number, day: number): Date {
  const wallClock = `${String(year).padStart(4, "0")}-${pad2(monthIndex + 1)}-${pad2(day)}T00:00:00`;
  return toAppTz(fromZonedTime(wallClock, APP_TIMEZONE));
}

// ─── Périodes ────────────────────────────────────────────────────────────────

const FIRST_MONTH_OF_SECOND_SEMESTER = 6;

function startOfZonedSemester(zoned: Date): Date {
  const firstMonth = zoned.getMonth() < FIRST_MONTH_OF_SECOND_SEMESTER ? 0 : 6;
  // `startOfYear` d'abord : le jour vaut 1, `setMonth` ne peut donc pas déborder.
  return setMonth(startOfYear(zoned), firstMonth);
}

function endOfZonedSemester(zoned: Date): Date {
  const lastMonth = zoned.getMonth() < FIRST_MONTH_OF_SECOND_SEMESTER ? 5 : 11;
  return endOfMonth(setMonth(startOfYear(zoned), lastMonth));
}

/**
 * Les bienniums sont alignés sur les années paires : 2026-2027, 2028-2029.
 * Une convention est indispensable — sans elle, « la période biennale contenant
 * le 3 mars 2027 » n'a pas de réponse unique. Elle vaut pour le calcul des
 * bornes comme pour les clés, afin que les deux ne puissent pas diverger.
 */
const BIENNIUM_YEARS = 2;

function biennumStartYear(year: number): number {
  return year - (((year % BIENNIUM_YEARS) + BIENNIUM_YEARS) % BIENNIUM_YEARS);
}

function startOfZonedBiennium(zoned: Date): Date {
  return zonedDateFromParts(biennumStartYear(zoned.getFullYear()), 0, 1);
}

function endOfZonedBiennium(zoned: Date): Date {
  return endOfYear(zonedDateFromParts(biennumStartYear(zoned.getFullYear()) + 1, 0, 1));
}

function startOfZonedPeriod(zoned: Date, periodicity: Periodicity): Date {
  switch (periodicity) {
    case Periodicity.MONTHLY:
      return startOfMonth(zoned);
    case Periodicity.QUARTERLY:
      return startOfQuarter(zoned);
    case Periodicity.SEMIANNUAL:
      return startOfZonedSemester(zoned);
    case Periodicity.ANNUAL:
      return startOfYear(zoned);
    case Periodicity.BIENNIAL:
      return startOfZonedBiennium(zoned);
    // Ni ON_EVENT ni CUSTOM ne découpent le calendrier : la période se réduit
    // au jour porteur (date de l'événement, ou date fixe de la règle).
    case Periodicity.ON_EVENT:
    case Periodicity.CUSTOM:
      return startOfDay(zoned);
  }
}

function endOfZonedPeriod(zoned: Date, periodicity: Periodicity): Date {
  switch (periodicity) {
    case Periodicity.MONTHLY:
      return endOfMonth(zoned);
    case Periodicity.QUARTERLY:
      return endOfQuarter(zoned);
    case Periodicity.SEMIANNUAL:
      return endOfZonedSemester(zoned);
    case Periodicity.ANNUAL:
      return endOfYear(zoned);
    case Periodicity.BIENNIAL:
      return endOfZonedBiennium(zoned);
    case Periodicity.ON_EVENT:
    case Periodicity.CUSTOM:
      return endOfDay(zoned);
  }
}

/** Premier instant de la période algérienne contenant `instant`. */
export function startOfPeriod(instant: Date, periodicity: Periodicity): Date {
  return toUtcFromAppTz(startOfZonedPeriod(toAppTz(instant), periodicity));
}

/**
 * Dernier instant de la période algérienne contenant `instant`.
 * Borne **inclusive**, à la milliseconde près (23:59:59.999 heure d'Alger).
 */
export function endOfPeriod(instant: Date, periodicity: Periodicity): Date {
  return toUtcFromAppTz(endOfZonedPeriod(toAppTz(instant), periodicity));
}

// ─── Clés de période ─────────────────────────────────────────────────────────

export interface PeriodBounds {
  /** Clé sans le suffixe rectificatif. */
  readonly base: string;
  /** 0 pour le dépôt initial, n ≥ 1 pour la n-ième rectificative. */
  readonly rectificationIndex: number;
  readonly periodicity: Periodicity;
  readonly start: Date;
  /** Borne inclusive. */
  readonly end: Date;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Clé de base d'une période, selon la périodicité :
 *
 * | Périodicité | Format      | Exemple      |
 * | ----------- | ----------- | ------------ |
 * | MONTHLY     | `yyyy-MM`   | `2026-01`    |
 * | QUARTERLY   | `yyyy-Qn`   | `2026-Q1`    |
 * | SEMIANNUAL  | `yyyy-Sn`   | `2026-S1`    |
 * | ANNUAL      | `yyyy`      | `2026`       |
 * | BIENNIAL    | `yyyy-yyyy` | `2026-2027`  |
 * | CUSTOM      | `yyyy-DMMdd`| `2026-D0331` |
 * | ON_EVENT    | `yyyy-EMMdd`| `2026-E0315` |
 */
function buildBaseKey(zoned: Date, periodicity: Periodicity): string {
  const year = zoned.getFullYear();
  const month = zoned.getMonth();

  switch (periodicity) {
    case Periodicity.MONTHLY:
      return `${String(year)}-${pad2(month + 1)}`;
    case Periodicity.QUARTERLY:
      return `${String(year)}-Q${String(Math.floor(month / 3) + 1)}`;
    case Periodicity.SEMIANNUAL:
      return `${String(year)}-S${String(month < FIRST_MONTH_OF_SECOND_SEMESTER ? 1 : 2)}`;
    case Periodicity.ANNUAL:
      return String(year);
    case Periodicity.BIENNIAL: {
      const start = biennumStartYear(year);
      return `${String(start)}-${String(start + 1)}`;
    }
    case Periodicity.CUSTOM:
      return `${String(year)}-D${pad2(month + 1)}${pad2(zoned.getDate())}`;
    case Periodicity.ON_EVENT:
      return `${String(year)}-E${pad2(month + 1)}${pad2(zoned.getDate())}`;
  }
}

/**
 * Clé de période, éventuellement rectificative.
 *
 * Une déclaration rectificative porte la même période que l'originale : elle ne
 * peut donc pas partager sa clé sans écraser la première. Le suffixe `-Rn` les
 * distingue tout en gardant la période lisible et triable.
 * `rectificationIndex` à 0 (défaut) produit la clé de base, sans suffixe :
 * une période n'a ainsi qu'une seule écriture possible.
 */
export function buildPeriodKey(
  instant: Date,
  periodicity: Periodicity,
  rectificationIndex = 0,
): string {
  if (!Number.isInteger(rectificationIndex) || rectificationIndex < 0) {
    throw AppError.validationFailed({
      rectificationIndex,
      reason: "RECTIFICATION_INDEX_INVALID",
    });
  }
  const base = buildBaseKey(toAppTz(instant), periodicity);
  return rectificationIndex === 0 ? base : `${base}-R${String(rectificationIndex)}`;
}

const RECTIFICATION_SUFFIX = /^(.+)-R([1-9]\d*)$/;
const MONTHLY_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;
const QUARTERLY_KEY = /^(\d{4})-Q([1-4])$/;
const SEMIANNUAL_KEY = /^(\d{4})-S([12])$/;
const BIENNIAL_KEY = /^(\d{4})-(\d{4})$/;
const CUSTOM_KEY = /^(\d{4})-D(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/;
const EVENT_KEY = /^(\d{4})-E(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/;
const ANNUAL_KEY = /^(\d{4})$/;

function invalidPeriodKey(key: string): AppError {
  // Champ nommé `period` : le logger masque tout nom contenant le mot « key ».
  return AppError.validationFailed({ period: key, reason: "PERIOD_KEY_MALFORMED" });
}

function captureText(match: RegExpExecArray, index: number, key: string): string {
  const raw = match[index];
  if (raw === undefined) throw invalidPeriodKey(key);
  return raw;
}

function captureInt(match: RegExpExecArray, index: number, key: string): number {
  return Number.parseInt(captureText(match, index, key), 10);
}

/**
 * Inverse exact de `buildPeriodKey` : les bornes rendues encadrent toute date
 * dont la clé est `key`.
 *
 * Lève une `AppError` VALIDATION_FAILED si la clé est malformée — une clé
 * illisible vient d'une donnée corrompue ou d'une saisie non validée, pas d'un
 * cas métier. Les appelants exposés à de l'entrée utilisateur l'enveloppent
 * dans `tryCatch()`.
 */
export function parsePeriodKey(key: string): PeriodBounds {
  const rectification = RECTIFICATION_SUFFIX.exec(key);
  const base = rectification === null ? key : captureText(rectification, 1, key);
  const rectificationIndex = rectification === null ? 0 : captureInt(rectification, 2, key);

  return { ...resolveBase(base, key), base, rectificationIndex };
}

type BaseBounds = Omit<PeriodBounds, "base" | "rectificationIndex">;

function resolveBase(base: string, key: string): BaseBounds {
  const monthly = MONTHLY_KEY.exec(base);
  if (monthly !== null) {
    return bounds(
      Periodicity.MONTHLY,
      zonedDateFromParts(captureInt(monthly, 1, key), captureInt(monthly, 2, key) - 1, 1),
    );
  }

  const quarterly = QUARTERLY_KEY.exec(base);
  if (quarterly !== null) {
    return bounds(
      Periodicity.QUARTERLY,
      zonedDateFromParts(captureInt(quarterly, 1, key), (captureInt(quarterly, 2, key) - 1) * 3, 1),
    );
  }

  const semiannual = SEMIANNUAL_KEY.exec(base);
  if (semiannual !== null) {
    return bounds(
      Periodicity.SEMIANNUAL,
      zonedDateFromParts(
        captureInt(semiannual, 1, key),
        (captureInt(semiannual, 2, key) - 1) * 6,
        1,
      ),
    );
  }

  const biennial = BIENNIAL_KEY.exec(base);
  if (biennial !== null) {
    const startYear = captureInt(biennial, 1, key);
    const endYear = captureInt(biennial, 2, key);
    // Seule la forme canonique est acceptée : sans cela « 2027-2028 » et
    // « 2026-2027 » désigneraient des périodes qui se chevauchent.
    if (startYear !== biennumStartYear(startYear) || endYear !== startYear + 1) {
      throw invalidPeriodKey(key);
    }
    return bounds(Periodicity.BIENNIAL, zonedDateFromParts(startYear, 0, 1));
  }

  const custom = CUSTOM_KEY.exec(base);
  if (custom !== null) {
    return bounds(Periodicity.CUSTOM, exactCalendarDate(custom, key));
  }

  const event = EVENT_KEY.exec(base);
  if (event !== null) {
    return bounds(Periodicity.ON_EVENT, exactCalendarDate(event, key));
  }

  const annual = ANNUAL_KEY.exec(base);
  if (annual !== null) {
    return bounds(Periodicity.ANNUAL, zonedDateFromParts(captureInt(annual, 1, key), 0, 1));
  }

  throw invalidPeriodKey(key);
}

/**
 * Construit la date d'une clé `yyyy-XMMdd` en refusant les jours inexistants :
 * `2026-D0231` doit échouer, pas glisser silencieusement au 3 mars.
 */
function exactCalendarDate(match: RegExpExecArray, key: string): Date {
  const year = captureInt(match, 1, key);
  const month = captureInt(match, 2, key);
  const day = captureInt(match, 3, key);
  const zoned = zonedDateFromParts(year, month - 1, day);
  if (zoned.getFullYear() !== year || zoned.getMonth() !== month - 1 || zoned.getDate() !== day) {
    throw invalidPeriodKey(key);
  }
  return zoned;
}

function bounds(periodicity: Periodicity, zonedAnchor: Date): BaseBounds {
  return {
    periodicity,
    start: toUtcFromAppTz(startOfZonedPeriod(zonedAnchor, periodicity)),
    end: toUtcFromAppTz(endOfZonedPeriod(zonedAnchor, periodicity)),
  };
}

// ─── Génération des périodes d'une obligation ────────────────────────────────

export interface PeriodDescriptor {
  /** Clé de base (jamais rectificative : une rectificative n'est pas générée). */
  readonly key: string;
  readonly periodicity: Periodicity;
  readonly start: Date;
  /** Borne inclusive. */
  readonly end: Date;
}

/** Une date fixe du calendrier civil, répétée chaque année. */
export interface CustomOccurrenceSpec {
  /** 1 à 12. */
  readonly month: number;
  /** 1 à 31. Ramené au dernier jour du mois s'il le dépasse (31 → 30 en avril). */
  readonly day: number;
}

/** Périodicités qui découpent le calendrier d'elles-mêmes. */
export type CalendarPeriodicity = Exclude<Periodicity, "ON_EVENT" | "CUSTOM">;

export type PeriodRule =
  | { readonly periodicity: CalendarPeriodicity }
  | { readonly periodicity: typeof Periodicity.ON_EVENT }
  | {
      readonly periodicity: typeof Periodicity.CUSTOM;
      readonly occurrences: readonly CustomOccurrenceSpec[];
    };

export interface PeriodRange {
  readonly from: Date;
  readonly to: Date;
}

function advanceZonedPeriod(zonedStart: Date, periodicity: CalendarPeriodicity): Date {
  switch (periodicity) {
    case Periodicity.MONTHLY:
      return addMonths(zonedStart, 1);
    case Periodicity.QUARTERLY:
      return addMonths(zonedStart, 3);
    case Periodicity.SEMIANNUAL:
      return addMonths(zonedStart, 6);
    case Periodicity.ANNUAL:
      return addYears(zonedStart, 1);
    case Periodicity.BIENNIAL:
      return addYears(zonedStart, BIENNIUM_YEARS);
  }
}

function describe(zonedAnchor: Date, periodicity: Periodicity): PeriodDescriptor {
  const { start, end } = bounds(periodicity, zonedAnchor);
  return { key: buildBaseKey(zonedAnchor, periodicity), periodicity, start, end };
}

function computeCustomPeriods(
  specs: readonly CustomOccurrenceSpec[],
  range: PeriodRange,
): PeriodDescriptor[] {
  for (const spec of specs) {
    if (
      !Number.isInteger(spec.month) ||
      !Number.isInteger(spec.day) ||
      spec.month < 1 ||
      spec.month > 12 ||
      spec.day < 1 ||
      spec.day > 31
    ) {
      throw AppError.validationFailed({
        month: spec.month,
        day: spec.day,
        reason: "CUSTOM_DATE_INVALID",
      });
    }
  }

  const firstYear = toAppTz(range.from).getFullYear();
  const lastYear = toAppTz(range.to).getFullYear();
  const periods: PeriodDescriptor[] = [];

  for (let year = firstYear; year <= lastYear; year += 1) {
    for (const spec of specs) {
      const monthStart = zonedDateFromParts(year, spec.month - 1, 1);
      // 31 février n'existe pas : on retient le dernier jour réel du mois.
      const day = Math.min(spec.day, endOfMonth(monthStart).getDate());
      periods.push(describe(zonedDateFromParts(year, spec.month - 1, day), Periodicity.CUSTOM));
    }
  }

  return periods
    .filter((period) => period.start <= range.to && period.end >= range.from)
    .sort((left, right) => left.start.getTime() - right.start.getTime());
}

/**
 * Périodes à générer pour une obligation sur un intervalle donné.
 *
 * Une période est retenue dès lors qu'elle **commence** au plus tard à `to` et
 * se **termine** au plus tôt à `from` : une période à cheval sur la borne est
 * incluse, jamais tronquée.
 *
 * `ON_EVENT` rend un tableau vide : rien n'est prévisible depuis le calendrier,
 * l'occurrence naît du fait déclencheur et se crée à la main.
 */
export function computePeriods(rule: PeriodRule, range: PeriodRange): PeriodDescriptor[] {
  if (range.to < range.from) {
    throw AppError.validationFailed({ reason: "PERIOD_RANGE_REVERSED" });
  }

  if (rule.periodicity === Periodicity.ON_EVENT) return [];
  if (rule.periodicity === Periodicity.CUSTOM) {
    return computeCustomPeriods(rule.occurrences, range);
  }

  const periods: PeriodDescriptor[] = [];
  const limit = toAppTz(range.to);
  let cursor = startOfZonedPeriod(toAppTz(range.from), rule.periodicity);

  while (cursor.getTime() <= limit.getTime()) {
    periods.push(describe(cursor, rule.periodicity));
    cursor = advanceZonedPeriod(cursor, rule.periodicity);
  }

  return periods;
}

// ─── Jours ouvrés ────────────────────────────────────────────────────────────

function toDayKey(zoned: Date): string {
  return format(zoned, "yyyy-MM-dd");
}

function toHolidayKeys(holidays: readonly Date[]): ReadonlySet<string> {
  return new Set(holidays.map((holiday) => toDayKey(toAppTz(holiday))));
}

function isZonedBusinessDay(zoned: Date, holidayKeys: ReadonlySet<string>): boolean {
  const day: number = zoned.getDay();
  if (WEEKEND_DAYS.some((weekendDay) => weekendDay === day)) return false;
  return !holidayKeys.has(toDayKey(zoned));
}

/** Vrai si `instant` tombe un jour ouvré algérien (hors week-end et hors férié). */
export function isBusinessDay(instant: Date, holidays: readonly Date[] = []): boolean {
  return isZonedBusinessDay(toAppTz(instant), toHolidayKeys(holidays));
}

/**
 * Décale de `count` jours ouvrés. `count` négatif remonte le temps, `0` rend
 * l'instant inchangé (même s'il tombe un jour chômé). L'heure du jour est conservée.
 */
export function addBusinessDays(
  instant: Date,
  count: number,
  holidays: readonly Date[] = [],
): Date {
  const holidayKeys = toHolidayKeys(holidays);
  const step = count < 0 ? -1 : 1;
  let remaining = Math.abs(count);
  let cursor = toAppTz(instant);

  while (remaining > 0) {
    cursor = addDays(cursor, step);
    if (isZonedBusinessDay(cursor, holidayKeys)) remaining -= 1;
  }

  return toUtcFromAppTz(cursor);
}

/**
 * Jour ouvré **suivant strictement** `instant`, heure conservée.
 * Pour « repousser une échéance qui tombe un jour chômé », utiliser
 * `snapForwardToBusinessDay()` : elle laisse la date intacte si elle est déjà ouvrée.
 */
export function nextBusinessDay(instant: Date, holidays: readonly Date[] = []): Date {
  return addBusinessDays(instant, 1, holidays);
}

/** Jour ouvré **précédant strictement** `instant`, heure conservée. */
export function previousBusinessDay(instant: Date, holidays: readonly Date[] = []): Date {
  return addBusinessDays(instant, -1, holidays);
}

/**
 * Rend `instant` inchangé s'il tombe un jour ouvré, sinon avance au prochain
 * jour ouvré. C'est la règle de report d'échéance.
 */
export function snapForwardToBusinessDay(instant: Date, holidays: readonly Date[] = []): Date {
  return snapToBusinessDay(instant, 1, holidays);
}

/** Symétrique de `snapForwardToBusinessDay` : recule jusqu'au jour ouvré. */
export function snapBackwardToBusinessDay(instant: Date, holidays: readonly Date[] = []): Date {
  return snapToBusinessDay(instant, -1, holidays);
}

function snapToBusinessDay(instant: Date, step: 1 | -1, holidays: readonly Date[]): Date {
  const holidayKeys = toHolidayKeys(holidays);
  let cursor = toAppTz(instant);
  // Itère : un férié accolé au week-end impose plusieurs sauts d'affilée.
  while (!isZonedBusinessDay(cursor, holidayKeys)) {
    cursor = addDays(cursor, step);
  }
  return toUtcFromAppTz(cursor);
}

/**
 * Applique la règle de report d'une obligation à une échéance calculée.
 *
 * Sémantique **symétrique et non stricte** : une date déjà ouvrée n'est jamais
 * déplacée, dans un sens comme dans l'autre. `PREVIOUS_BUSINESS_DAY` sert aux
 * échéances qui ne doivent pas glisser vers l'aval ; il ne recule pas d'un jour,
 * il ramène au dernier jour ouvré. Pour un recul systématique, utiliser
 * `previousBusinessDay()`.
 */
export function shiftDate(
  instant: Date,
  direction: DateShift,
  holidays: readonly Date[] = [],
): Date {
  switch (direction) {
    case DateShift.NONE:
      return instant;
    case DateShift.NEXT_BUSINESS_DAY:
      return snapForwardToBusinessDay(instant, holidays);
    case DateShift.PREVIOUS_BUSINESS_DAY:
      return snapBackwardToBusinessDay(instant, holidays);
  }
}

// ─── Formatage et écarts ─────────────────────────────────────────────────────

/**
 * Date du jour au format ISO (`2026-01-15`), calendrier d ALGER.
 *
 * ⚠️ `new Date().toISOString().slice(0, 10)` donnerait la date UTC : entre 23 h
 * et minuit a Alger, elle est encore celle de la veille. C est exactement le
 * genre d ecart d un jour qui ne se voit qu en production.
 */
export function formatISODateInAppTz(instant?: Date): string {
  return formatInTimeZone(instant ?? new Date(), APP_TIMEZONE, "yyyy-MM-dd");
}

/** `15/01/2026`, heure d'Alger. */
export function formatDateFr(instant: Date): string {
  return formatInTimeZone(instant, APP_TIMEZONE, "dd/MM/yyyy", { locale: fr });
}

/** `15/01/2026 14:30`, heure d'Alger. */
export function formatDateTimeFr(instant: Date): string {
  return formatInTimeZone(instant, APP_TIMEZONE, "dd/MM/yyyy HH:mm", { locale: fr });
}

/**
 * Nombre de jours calendaires algériens séparant `from` (par défaut : maintenant)
 * de `target`. Négatif si l'échéance est dépassée. Compte des jours civils, pas
 * des tranches de 24 h : 23 h 00 aujourd'hui → 01 h 00 demain vaut 1.
 */
export function daysUntil(target: Date, from?: Date): number {
  const fromZoned = from === undefined ? nowInAppTz() : toAppTz(from);
  return differenceInCalendarDays(toAppTz(target), fromZoned);
}
