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
  differenceInCalendarDays,
  endOfMonth,
  endOfQuarter,
  endOfYear,
  format,
  setMonth,
  startOfMonth,
  startOfQuarter,
  startOfYear,
} from "date-fns";
import { fr } from "date-fns/locale";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

import { Periodicity } from "@/config/constants";
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
  readonly periodicity: Periodicity;
  readonly start: Date;
  /** Borne inclusive. */
  readonly end: Date;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** `'2026-01' | '2026-Q1' | '2026-S1' | '2026'` selon la périodicité. */
export function buildPeriodKey(instant: Date, periodicity: Periodicity): string {
  const zoned = toAppTz(instant);
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
  }
}

const MONTHLY_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;
const QUARTERLY_KEY = /^(\d{4})-Q([1-4])$/;
const SEMIANNUAL_KEY = /^(\d{4})-S([12])$/;
const ANNUAL_KEY = /^(\d{4})$/;

function invalidPeriodKey(key: string): AppError {
  // Champ nommé `period` : le logger masque tout nom contenant le mot « key ».
  return AppError.validationFailed({ period: key, reason: "PERIOD_KEY_MALFORMED" });
}

function captureInt(match: RegExpExecArray, index: number, key: string): number {
  const raw = match[index];
  if (raw === undefined) throw invalidPeriodKey(key);
  return Number.parseInt(raw, 10);
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
  const monthly = MONTHLY_KEY.exec(key);
  if (monthly !== null) {
    const zoned = zonedDateFromParts(
      captureInt(monthly, 1, key),
      captureInt(monthly, 2, key) - 1,
      1,
    );
    return bounds(Periodicity.MONTHLY, zoned);
  }

  const quarterly = QUARTERLY_KEY.exec(key);
  if (quarterly !== null) {
    const zoned = zonedDateFromParts(
      captureInt(quarterly, 1, key),
      (captureInt(quarterly, 2, key) - 1) * 3,
      1,
    );
    return bounds(Periodicity.QUARTERLY, zoned);
  }

  const semiannual = SEMIANNUAL_KEY.exec(key);
  if (semiannual !== null) {
    const zoned = zonedDateFromParts(
      captureInt(semiannual, 1, key),
      (captureInt(semiannual, 2, key) - 1) * 6,
      1,
    );
    return bounds(Periodicity.SEMIANNUAL, zoned);
  }

  const annual = ANNUAL_KEY.exec(key);
  if (annual !== null) {
    const zoned = zonedDateFromParts(captureInt(annual, 1, key), 0, 1);
    return bounds(Periodicity.ANNUAL, zoned);
  }

  throw invalidPeriodKey(key);
}

function bounds(periodicity: Periodicity, zonedAnchor: Date): PeriodBounds {
  return {
    periodicity,
    start: toUtcFromAppTz(startOfZonedPeriod(zonedAnchor, periodicity)),
    end: toUtcFromAppTz(endOfZonedPeriod(zonedAnchor, periodicity)),
  };
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

/**
 * Rend `instant` inchangé s'il tombe un jour ouvré, sinon avance au prochain
 * jour ouvré. C'est la règle de report d'échéance.
 */
export function snapForwardToBusinessDay(instant: Date, holidays: readonly Date[] = []): Date {
  const holidayKeys = toHolidayKeys(holidays);
  let cursor = toAppTz(instant);
  while (!isZonedBusinessDay(cursor, holidayKeys)) {
    cursor = addDays(cursor, 1);
  }
  return toUtcFromAppTz(cursor);
}

// ─── Formatage et écarts ─────────────────────────────────────────────────────

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
