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

import {
  type Criticality,
  DateShift,
  DueAnchor,
  INTERNAL_LEAD_DAYS_BY_CRITICALITY,
  Periodicity,
} from "@/config/constants";
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

  const internalDueDate = computeInternalDueDate(
    shifted.value.date,
    input.internalLeadDays ?? 0,
    holidays,
  );

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

/**
 * Marge à appliquer : celle de l'obligation, ou le défaut de sa criticité.
 *
 * ⚠️ Les valeurs par défaut viennent de `INTERNAL_LEAD_DAYS_BY_CRITICALITY`
 * (`src/config/constants.ts`), jamais d'une table locale. J'en avais d'abord
 * écrit une copie ici : deux tables de marges auraient divergé au premier
 * ajustement, et c'est exactement ce que ce projet refuse partout ailleurs.
 *
 * `internal_lead_days = 0` est traité comme « non renseigné ». La colonne est
 * `not null default 0` : elle ne sait pas distinguer l'absence de valeur d'un
 * zéro voulu. Une obligation CRITICAL qui voudrait réellement zéro jour de marge
 * n'est donc pas exprimable — le cas ne s'est pas présenté, et le lever
 * demanderait de rendre la colonne nullable. À signaler s'il se présente.
 */
export function resolveLeadDays(criticality: Criticality, internalLeadDays: number): number {
  return internalLeadDays > 0 ? internalLeadDays : INTERNAL_LEAD_DAYS_BY_CRITICALITY[criticality];
}

/**
 * Échéance INTERNE : recul de `leadDays` jours OUVRÉS sur l'échéance légale.
 *
 * ⚠️ Jours ouvrés, jamais calendaires : « cinq jours d'avance » veut dire cinq
 * jours de travail. Compter en jours calendaires ferait tomber la marge sur un
 * week-end et rendrait l'avance fictive — exactement l'inverse de ce qu'elle
 * cherche à produire.
 *
 * Une marge nulle rend l'échéance légale elle-même : l'échéance interne existe
 * toujours, elle coïncide simplement avec la légale.
 */
export function computeInternalDueDate(
  legalDueDate: Date,
  leadDays: number,
  holidays: readonly Date[] = [],
): Date {
  if (leadDays <= 0) return legalDueDate;
  return addBusinessDays(legalDueDate, -leadDays, holidays);
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
      /*
       * ⚠️ L'ANNÉE DE RÉFÉRENCE EST CELLE DU DÉBUT DE PÉRIODE, SANS year_offset.
       *
       * `year_offset` n'est plus appliqué ici mais dans `applyOffsets`, en
       * quatrième position de l'ordre arrêté :
       *   ancre → offset_months → offset_days → year_offset → reports.
       *
       * La différence n'est pas cosmétique. Appliqué à l'ancre, `year_offset`
       * changeait l'année AVANT le calage de fin de mois : une règle au 29
       * février avec `year_offset: 1` était ramenée au 28 dès l'ancre, puis
       * décalée. Appliqué en dernier, le calage se fait sur l'année finale, qui
       * est la seule qui compte.
       */
      const year = toAppTz(period.start).getFullYear();
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
 * Décalages, dans l'ORDRE ARRÊTÉ : mois, puis jours, puis années.
 *
 * ⚠️ L'ordre n'est pas indifférent, et c'est pour cela qu'il est fixé plutôt que
 * laissé à la lecture. `+1 mois puis +5 jours` et `+5 jours puis +1 mois` depuis
 * le 30 janvier ne donnent pas la même date : le calage de fin de mois
 * intervient entre les deux. Le même raisonnement vaut pour l'année, appliquée
 * en dernier — elle décale un 29 février sur une année non bissextile, et ce
 * calage doit se faire sur la date déjà décalée, pas sur l'ancre.
 *
 * Ordre complet du calcul : ancre → offset_months → offset_days → year_offset
 * → report week-end → report jour férié.
 */
function applyOffsets(base: Date, rule: DueRule): Date {
  let zoned = toAppTz(base);
  if (rule.offset_months !== undefined && rule.offset_months !== 0) {
    zoned = addMonths(zoned, rule.offset_months);
  }
  if (rule.offset_days !== undefined && rule.offset_days !== 0) {
    zoned = addDays(zoned, rule.offset_days);
  }
  if (rule.year_offset !== undefined && rule.year_offset !== 0) {
    zoned = addYears(zoned, rule.year_offset);
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
    /*
     * ⚠️ INATTEIGNABLE, et conservé pour l'exhaustivité du compilateur.
     *
     * Cette fonction n'est appelée que par `eventDrivenPeriods`. Or
     * `validateDueRule` refuse CUSTOM avec une ancre événementielle
     * (« CUSTOM_REQUIRES_PERIOD_ANCHOR »), et ON_EVENT ne produit qu'UNE ligne —
     * l'appel s'y fait donc toujours avec `steps === 0`, court-circuité plus
     * haut. Vérifié en exécutant les trois combinaisons.
     *
     * Retirer ces cas ferait perdre l'exhaustivité du `switch` : le jour où une
     * périodicité s'ajoute, le compilateur ne signalerait plus rien.
     */
    /* v8 ignore start */
    case Periodicity.CUSTOM:
    case Periodicity.ON_EVENT:
      return instant;
    /* v8 ignore stop */
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
  /*
   * ⚠️ INATTEIGNABLE. `validateDueRule` impose une ancre événementielle à
   * ON_EVENT, qui emprunte donc systématiquement l'autre branche. Conservé comme
   * garde de dernier ressort si cette règle évoluait.
   */
  /* v8 ignore start */
  if (periodicity === Periodicity.ON_EVENT) {
    return err(AppError.validationFailed({ reason: "ON_EVENT_REQUIRES_EVENT_ANCHOR" }));
  }
  /* v8 ignore stop */

  /*
   * ⚠️ Les replis `?? []` et `?? 1` ci-dessous sont INATTEIGNABLES : une règle
   * CUSTOM sans `occurrences[]` est refusée par `validateDueRule`, appelée en
   * tête de `previewDueDates`. Ils restent parce qu'ils coûtent un caractère et
   * évitent une exception si cette validation venait à bouger.
   */
  /* v8 ignore start */
  const periodRule: PeriodRule =
    periodicity === Periodicity.CUSTOM
      ? { periodicity, occurrences: rule.occurrences ?? [] }
      : { periodicity };
  /* v8 ignore stop */

  // Fenêtre volontairement large : `computePeriods` borne par intersection, on
  // tronque ensuite. Trop courte, elle rendrait moins de lignes que demandé.
  /* v8 ignore start */
  const spanMonths =
    periodicity === Periodicity.CUSTOM
      ? 12 * (Math.ceil(count / Math.max(rule.occurrences?.length ?? 1, 1)) + 1)
      : // `MONTHS_PER_PERIOD` couvre les cinq périodicités calendaires ; le repli
        // à 12 ne sert qu'à ne pas produire `NaN` si une sixième s'ajoutait.
        (MONTHS_PER_PERIOD[periodicity] ?? 12) * (count + 1);
  /* v8 ignore stop */

  const to = toUtcFromAppTz(addMonths(toAppTz(from), spanMonths));

  try {
    return ok(computePeriods(periodRule, { from, to }).slice(0, count));
    /*
     * ⚠️ INATTEIGNABLE en l'état : `computePeriods` ne lève que sur une date
     * CUSTOM invalide, que Zod refuse en amont. On convertit malgré tout plutôt
     * que de laisser filer une exception — le jour où la validation change,
     * c'est cette conversion qui évitera une page blanche.
     */
    /* v8 ignore start */
  } catch (cause) {
    return err(AppError.from(cause));
  }
  /* v8 ignore stop */
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
