/**
 * Utilitaires de date ancrés sur `Africa/Algiers` (cf. CLAUDE.md §2).
 *
 * Règle : aucune date métier ne se calcule sur l'heure locale de la machine.
 * Les instants sont stockés en UTC ; la conversion se fait ici, explicitement.
 *
 * Implémentation volontairement sans dépendance : `Intl` connaît la base IANA.
 * `date-fns` / `date-fns-tz` viendront pour le formatage localisé, pas pour
 * remplacer ces primitives.
 */

import { APP_TIME_ZONE } from "@/config/constants";

export interface ZonedDateTimeParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

type PartKey = keyof ZonedDateTimeParts;

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function readPart(parts: ReadonlyMap<string, number>, key: PartKey): number {
  const value = parts.get(key);
  if (value === undefined || Number.isNaN(value)) {
    throw new Error(`Champ de date « ${key} » illisible pour le fuseau ${APP_TIME_ZONE}.`);
  }
  return value;
}

/** Décompose un instant en composantes calendaires telles que vues à Alger. */
export function getPartsInAppTimeZone(instant: Date): ZonedDateTimeParts {
  const raw = new Map<string, number>();
  for (const part of partsFormatter.formatToParts(instant)) {
    if (part.type !== "literal") {
      raw.set(part.type, Number.parseInt(part.value, 10));
    }
  }
  return {
    year: readPart(raw, "year"),
    month: readPart(raw, "month"),
    day: readPart(raw, "day"),
    hour: readPart(raw, "hour"),
    minute: readPart(raw, "minute"),
    second: readPart(raw, "second"),
  };
}

/** Décalage du fuseau, en millisecondes, effectif à cet instant. */
function timeZoneOffsetMs(instant: Date): number {
  const parts = getPartsInAppTimeZone(instant);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  // `formatToParts` ne restitue pas les millisecondes : on compare à la seconde.
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Construit l'instant UTC correspondant à une date/heure exprimée à Alger.
 * Deux passes pour rester correct si le fuseau venait à introduire un DST.
 */
export function fromAppTimeZoneParts(parts: ZonedDateTimeParts): Date {
  const naiveUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const firstGuess = new Date(naiveUtc - timeZoneOffsetMs(new Date(naiveUtc)));
  return new Date(naiveUtc - timeZoneOffsetMs(firstGuess));
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, "0");
}

/** Jour calendaire à Alger, au format `yyyy-MM-dd`. */
export function toAppTimeZoneDateString(instant: Date): string {
  const { year, month, day } = getPartsInAppTimeZone(instant);
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

const DATE_STRING_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Interprète `yyyy-MM-dd` comme un jour civil algérien (début de journée). */
export function parseAppTimeZoneDateString(value: string): Date {
  const match = DATE_STRING_PATTERN.exec(value);
  if (match === null) {
    throw new Error(`Date « ${value} » invalide : format attendu yyyy-MM-dd.`);
  }
  const [, year, month, day] = match;
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Date « ${value} » invalide : format attendu yyyy-MM-dd.`);
  }
  return fromAppTimeZoneParts({
    year: Number.parseInt(year, 10),
    month: Number.parseInt(month, 10),
    day: Number.parseInt(day, 10),
    hour: 0,
    minute: 0,
    second: 0,
  });
}

/** Instant UTC du premier moment de la journée algérienne contenant `instant`. */
export function startOfDayInAppTimeZone(instant: Date): Date {
  const { year, month, day } = getPartsInAppTimeZone(instant);
  return fromAppTimeZoneParts({ year, month, day, hour: 0, minute: 0, second: 0 });
}

/**
 * Instant UTC du dernier moment de la journée algérienne contenant `instant`.
 * Une échéance « au 20 » expire à cet instant, pas à minuit UTC.
 */
export function endOfDayInAppTimeZone(instant: Date): Date {
  const { year, month, day } = getPartsInAppTimeZone(instant);
  return fromAppTimeZoneParts({ year, month, day, hour: 23, minute: 59, second: 59 });
}

/** Nombre de jours civils algériens entre deux instants (`to` − `from`). */
export function daysBetweenInAppTimeZone(from: Date, to: Date): number {
  const MS_PER_DAY = 86_400_000;
  const start = startOfDayInAppTimeZone(from).getTime();
  const end = startOfDayInAppTimeZone(to).getTime();
  return Math.round((end - start) / MS_PER_DAY);
}
