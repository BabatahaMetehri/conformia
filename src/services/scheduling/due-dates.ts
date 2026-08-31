/**
 * Calcul d'échéance — L'UNIQUE IMPLÉMENTATION DU PROJET.
 *
 * ⚠️ Toute date d'échéance affichée, prévisualisée, recalculée ou générée passe
 * par `computeDueDate()`. Une seconde implémentation, fût-elle « juste pour la
 * prévisualisation », finirait par diverger — et le jour où elle diverge,
 * l'écran qui devait donner confiance devient précisément ce qui trompe. Le
 * moteur de génération (prompt 5.1) appellera ces mêmes fonctions.
 *
 * Module PUR : aucune base, aucune session, aucun `new Date()` implicite. Les
 * jours fériés sont une donnée d'entrée, pas une dépendance.
 */

import { addDays, addMonths, addYears, endOfMonth } from "date-fns";

import { DateShift, DueAnchor, Periodicity } from "@/config/constants";
import {
  addBusinessDays,
  buildPeriodKey,
  computePeriods,
  endOfPeriod,
  isBusinessDay,
  nowInAppTz,
  startOfPeriod,
  toAppTz,
  toUtcFromAppTz,
  WEEKEND_DAYS,
  type PeriodDescriptor,
  type PeriodRule,
} from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { isEventDrivenAnchor, validateDueRule, type DueRule } from "@/services/scheduling/due-rule";

/** Nombre de dates proposées par défaut dans la prévisualisation. */
export const DEFAULT_PREVIEW_COUNT = 6;

const MAX_PREVIEW_COUNT = 24;

/**
 * Garde-fou du report : au-delà, la règle est pathologique (jours fériés
 * consécutifs sur deux semaines) et l'on préfère une erreur à une boucle.
 */
const MAX_SHIFT_STEPS = 14;

// ─── Résultat ────────────────────────────────────────────────────────────────

export type ShiftReason = "WEEKEND" | "HOLIDAY";

export interface DueDatePreview {
  readonly periodKey: string;
  readonly periodStart: Date;
  /** Borne incluse. */
  readonly periodEnd: Date;
  /** Échéance AVANT report. Affichée pour rendre le report visible. */
  readonly rawDueDate: Date;
  /** Échéance légale, report appliqué. */
  readonly legalDueDate: Date;
  /** Échéance interne : marge d'avance en jours ouvrés sur l'échéance légale. */
  readonly internalDueDate: Date;
  /** `null` si la date brute tombait déjà un jour ouvré. */
  readonly shiftReason: ShiftReason | null;
}

// ─── Calcul d'une échéance ───────────────────────────────────────────────────

export interface ComputeDueDateInput {
  readonly rule: DueRule;
  readonly period: PeriodDescriptor;
  /**
   * Date d'expiration ou date du fait déclencheur. Obligatoire pour les ancres
   * `EXPIRY_DATE` et `EVENT_DATE`, ignorée pour les autres.
   */
  readonly anchorDate?: Date | undefined;
  readonly holidays?: readonly Date[] | undefined;
  /** Marge interne, en jours OUVRÉS, retranchée à l'échéance légale. */
  readonly internalLeadDays?: number | undefined;
}

/**
 * Échéance d'une période donnée.
 *
 * La règle n'est PAS revalidée ici : `previewDueDates` et le moteur de
 * génération la valident une fois, en amont de leur boucle. Revalider à chaque
 * période coûterait une analyse Zod par ligne pour un résultat identique.
 */
export function computeDueDate(input: ComputeDueDateInput): Result<DueDatePreview> {
  const { rule, period } = input;
  const holidays = input.holidays ?? [];

  const base = anchorInstant(rule, period, input.anchorDate);
  if (!base.ok) return base;

  const rawDueDate = applyOffsets(base.value, rule);

  const shifted = applyShift(rawDueDate, rule, holidays);
  if (!shifted.ok) return shifted;

  const leadDays = input.internalLeadDays ?? 0;
  // Marge comptée en jours OUVRÉS : « cinq jours d'avance » veut dire cinq jours
  // de travail, pas cinq jours dont un week-end.
  const internalDueDate =
    leadDays > 0 ? addBusinessDays(shifted.value.date, -leadDays, holidays) : shifted.value.date;

  return ok({
    periodKey: period.key,
    periodStart: period.start,
    periodEnd: period.end,
    rawDueDate,
    legalDueDate: shifted.value.date,
    internalDueDate,
    shiftReason: shifted.value.reason,
  });
}

function anchorInstant(
  rule: DueRule,
  period: PeriodDescriptor,
  anchorDate: Date | undefined,
): Result<Date> {
  switch (rule.anchor) {
    case DueAnchor.PERIOD_END:
      return ok(period.end);

    case DueAnchor.PERIOD_START:
      return ok(period.start);

    case DueAnchor.FIXED_DATE: {
      if (rule.fixed_month === undefined || rule.fixed_day === undefined) {
        return err(AppError.validationFailed({ reason: "FIXED_DATE_REQUIRES_MONTH_AND_DAY" }));
      }
      // L'année de référence est celle du DÉBUT de période : pour un exercice
      // 2026, un bilan « au 30 avril » se dépose en 2027 via `year_offset: 1`.
      const year = toAppTz(period.start).getFullYear() + (rule.year_offset ?? 0);
      return ok(calendarDate(year, rule.fixed_month, rule.fixed_day));
    }

    case DueAnchor.EXPIRY_DATE:
    case DueAnchor.EVENT_DATE: {
      if (anchorDate === undefined) {
        return err(
          AppError.validationFailed({ reason: "ANCHOR_DATE_REQUIRED", anchor: rule.anchor }),
        );
      }
      return ok(anchorDate);
    }
  }
}

/** Date civile algérienne, jour ramené au dernier du mois s'il le dépasse. */
function calendarDate(year: number, month: number, day: number): Date {
  const firstOfMonth = toAppTz(toUtcFromAppTz(new Date(year, month - 1, 1, 12, 0, 0, 0)));
  const safeDay = Math.min(day, endOfMonth(firstOfMonth).getDate());
  return toUtcFromAppTz(new Date(year, month - 1, safeDay, 12, 0, 0, 0));
}

/**
 * Mois d'abord, jours ensuite. L'ordre compte : `+1 mois puis +5 jours` depuis le
 * 31 janvier donne le 5 mars, tandis que `+5 jours puis +1 mois` donne le 5 mars
 * également — mais depuis le 30 janvier, les deux ordres divergent. On fixe
 * l'ordre plutôt que de laisser le résultat dépendre de la lecture.
 */
function applyOffsets(base: Date, rule: DueRule): Date {
  let zoned = toAppTz(base);
  if (rule.offset_months !== undefined && rule.offset_months !== 0) {
    zoned = addMonths(zoned, rule.offset_months);
  }
  if (rule.offset_days !== undefined && rule.offset_days !== 0) {
    zoned = addDays(zoned, rule.offset_days);
  }
  return toUtcFromAppTz(zoned);
}

interface ShiftOutcome {
  readonly date: Date;
  readonly reason: ShiftReason | null;
}

function isWeekend(instant: Date): boolean {
  const day: number = toAppTz(instant).getDay();
  return WEEKEND_DAYS.some((weekendDay) => weekendDay === day);
}

/**
 * Applique les reports.
 *
 * Chaque cause a sa directive : un week-end suit `weekend_shift`, un férié suit
 * `holiday_shift`. Une directive `NONE` rend sa cause NON bloquante — une
 * échéance peut donc légitimement tomber un samedi si la règle le dit.
 *
 * `validateDueRule` refuse en amont deux directives opposées, seule combinaison
 * capable de faire osciller cette boucle. La borne reste par sécurité : mieux
 * vaut une erreur qu'un serveur qui tourne en rond.
 */
function applyShift(
  rawDueDate: Date,
  rule: DueRule,
  holidays: readonly Date[],
): Result<ShiftOutcome> {
  const holidayKeys = new Set(holidays.map((holiday) => dayKey(holiday)));

  let cursor = rawDueDate;
  let reason: ShiftReason | null = null;

  for (let step = 0; step <= MAX_SHIFT_STEPS; step += 1) {
    const weekendBlocks = rule.weekend_shift !== DateShift.NONE && isWeekend(cursor);
    const holidayBlocks = rule.holiday_shift !== DateShift.NONE && holidayKeys.has(dayKey(cursor));

    if (!weekendBlocks && !holidayBlocks) {
      return ok({ date: cursor, reason });
    }

    // Le férié prime dans le libellé : c'est l'information la moins devinable.
    const cause: ShiftReason = holidayBlocks ? "HOLIDAY" : "WEEKEND";
    reason ??= cause;

    const direction = holidayBlocks ? rule.holiday_shift : rule.weekend_shift;
    cursor = toUtcFromAppTz(
      addDays(toAppTz(cursor), direction === DateShift.PREVIOUS_BUSINESS_DAY ? -1 : 1),
    );
  }

  return err(
    AppError.validationFailed({
      field: "due_rule",
      reason: "SHIFT_DOES_NOT_CONVERGE",
      steps: MAX_SHIFT_STEPS,
    }),
  );
}

function dayKey(instant: Date): string {
  const zoned = toAppTz(instant);
  return `${String(zoned.getFullYear())}-${String(zoned.getMonth() + 1).padStart(2, "0")}-${String(zoned.getDate()).padStart(2, "0")}`;
}

// ─── Prévisualisation ────────────────────────────────────────────────────────

export interface PreviewDueDatesInput {
  readonly rule: unknown;
  readonly periodicity: Periodicity;
  /** Défaut : 6. Borné à 24 — au-delà, la liste ne se lit plus. */
  readonly count?: number | undefined;
  /** Point de départ. Défaut : maintenant, heure d'Alger. */
  readonly from?: Date | undefined;
  readonly holidays?: readonly Date[] | undefined;
  readonly internalLeadDays?: number | undefined;
  /** Requis pour les ancres `EXPIRY_DATE` et `EVENT_DATE`. */
  readonly anchorDate?: Date | undefined;
}

/**
 * Les `count` prochaines échéances calculées par cette règle.
 *
 * PURE : sans base, sans réseau, sans horloge implicite si `from` est fourni.
 * C'est ce qui la rend testable sur les 7 périodicités et les 5 ancres, et
 * réutilisable telle quelle par le moteur de génération.
 *
 * La première période est celle qui CONTIENT `from`, même si son échéance est
 * déjà passée : l'utilisateur qui vérifie une règle veut reconnaître la période
 * en cours, pas commencer à la suivante.
 */
export function previewDueDates(input: PreviewDueDatesInput): Result<DueDatePreview[]> {
  const validated = validateDueRule({ rule: input.rule, periodicity: input.periodicity });
  if (!validated.ok) return validated;

  const rule = validated.value;
  const count = Math.min(Math.max(input.count ?? DEFAULT_PREVIEW_COUNT, 1), MAX_PREVIEW_COUNT);
  const from = input.from ?? toUtcFromAppTz(nowInAppTz());

  const periods = isEventDrivenAnchor(rule.anchor)
    ? eventDrivenPeriods(input, count)
    : calendarPeriods(rule, input.periodicity, from, count);

  if (!periods.ok) return periods;

  const previews: DueDatePreview[] = [];
  for (const period of periods.value) {
    const computed = computeDueDate({
      rule,
      period,
      anchorDate: period.anchorDate,
      holidays: input.holidays,
      internalLeadDays: input.internalLeadDays,
    });
    if (!computed.ok) return computed;
    previews.push(computed.value);
  }

  return ok(previews);
}

interface PreviewPeriod extends PeriodDescriptor {
  readonly anchorDate?: Date | undefined;
}

/**
 * Périodes d'une ancre événementielle.
 *
 * La date de référence n'est pas dans le calendrier : elle est portée par le
 * dossier (expiration d'un agrément, date d'un sinistre). On la projette en
 * avant au rythme de la périodicité — un agrément annuel expire chaque année à
 * la même date.
 *
 * ON_EVENT ne rend QU'UNE ligne : sans périodicité, rien ne permet de deviner
 * quand le fait se reproduira. Inventer cinq dates supplémentaires donnerait à
 * l'écran une assurance qu'il n'a pas.
 */
function eventDrivenPeriods(input: PreviewDueDatesInput, count: number): Result<PreviewPeriod[]> {
  if (input.anchorDate === undefined) {
    return err(AppError.validationFailed({ reason: "ANCHOR_DATE_REQUIRED" }));
  }

  const wanted = input.periodicity === Periodicity.ON_EVENT ? 1 : count;
  const periods: PreviewPeriod[] = [];

  for (let index = 0; index < wanted; index += 1) {
    const anchorDate = advanceByPeriodicity(input.anchorDate, input.periodicity, index);
    periods.push({
      key: buildPeriodKey(anchorDate, input.periodicity),
      periodicity: input.periodicity,
      start: startOfPeriod(anchorDate, input.periodicity),
      end: endOfPeriod(anchorDate, input.periodicity),
      anchorDate,
    });
  }

  return ok(periods);
}

function advanceByPeriodicity(instant: Date, periodicity: Periodicity, steps: number): Date {
  if (steps === 0) return instant;
  const zoned = toAppTz(instant);

  switch (periodicity) {
    case Periodicity.MONTHLY:
      return toUtcFromAppTz(addMonths(zoned, steps));
    case Periodicity.QUARTERLY:
      return toUtcFromAppTz(addMonths(zoned, 3 * steps));
    case Periodicity.SEMIANNUAL:
      return toUtcFromAppTz(addMonths(zoned, 6 * steps));
    case Periodicity.ANNUAL:
      return toUtcFromAppTz(addYears(zoned, steps));
    case Periodicity.BIENNIAL:
      return toUtcFromAppTz(addYears(zoned, 2 * steps));
    case Periodicity.CUSTOM:
    case Periodicity.ON_EVENT:
      return instant;
  }
}

/** Mois couverts par une période, pour dimensionner l'intervalle de recherche. */
const MONTHS_PER_PERIOD: Readonly<Record<string, number>> = {
  [Periodicity.MONTHLY]: 1,
  [Periodicity.QUARTERLY]: 3,
  [Periodicity.SEMIANNUAL]: 6,
  [Periodicity.ANNUAL]: 12,
  [Periodicity.BIENNIAL]: 24,
};

function calendarPeriods(
  rule: DueRule,
  periodicity: Periodicity,
  from: Date,
  count: number,
): Result<PreviewPeriod[]> {
  if (periodicity === Periodicity.ON_EVENT) {
    // Interdit par `validateDueRule` (ON_EVENT exige une ancre événementielle) :
    // ce retour ne sert que d'exhaustivité au compilateur.
    return err(AppError.validationFailed({ reason: "ON_EVENT_REQUIRES_EVENT_ANCHOR" }));
  }

  const periodRule: PeriodRule =
    periodicity === Periodicity.CUSTOM
      ? { periodicity, occurrences: rule.occurrences ?? [] }
      : { periodicity };

  // Fenêtre volontairement large : `computePeriods` borne par intersection, on
  // tronque ensuite. Trop courte, elle rendrait moins de lignes que demandé.
  const spanMonths =
    periodicity === Periodicity.CUSTOM
      ? 12 * (Math.ceil(count / Math.max(rule.occurrences?.length ?? 1, 1)) + 1)
      : (MONTHS_PER_PERIOD[periodicity] ?? 12) * (count + 1);

  const to = toUtcFromAppTz(addMonths(toAppTz(from), spanMonths));

  try {
    return ok(computePeriods(periodRule, { from, to }).slice(0, count));
  } catch (cause) {
    // `computePeriods` lève sur une date CUSTOM invalide. Zod l'a déjà refusée
    // en amont ; on convertit malgré tout plutôt que de laisser filer.
    return err(AppError.from(cause));
  }
}

// ─── Utilitaire d'affichage ──────────────────────────────────────────────────

/** Vrai si la date brute a été déplacée par le report. */
export function wasShifted(preview: DueDatePreview): boolean {
  return preview.shiftReason !== null;
}

/** Vrai si l'échéance légale tombe un jour ouvré — invariant attendu du report. */
export function landsOnBusinessDay(
  preview: DueDatePreview,
  holidays: readonly Date[] = [],
): boolean {
  return isBusinessDay(preview.legalDueDate, holidays);
}
