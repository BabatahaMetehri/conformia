/**
 * Surface publique du moteur d'échéance.
 *
 * ⚠️ Aucun autre module ne calcule de date d'échéance. Le formulaire du
 * référentiel, la prévisualisation en direct, le recalcul après modification de
 * règle et le moteur de génération d'occurrences appellent tous ces fonctions —
 * c'est la garantie qu'une date affichée est la date qui sera générée.
 */

export {
  computeDueDate,
  computeInternalDueDate,
  resolveLeadDays,
  previewDueDates,
  landsOnBusinessDay,
  wasShifted,
  DEFAULT_PREVIEW_COUNT,
  type ComputeDueDateInput,
  type DueDatePreview,
  type PreviewDueDatesInput,
  type ShiftReason,
} from "@/services/scheduling/due-dates";

export {
  defaultDueRule,
  isEventDrivenAnchor,
  validateDueRule,
  CustomOccurrenceSchema,
  DueRuleSchema,
  EVENT_DRIVEN_ANCHORS,
  type CustomOccurrence,
  type DueRule,
  type DueRuleInput,
  type DueRuleValidationInput,
} from "@/services/scheduling/due-rule";

/**
 * Découpage en périodes.
 *
 * ⚠️ Réexporté depuis `@/lib/dates` plutôt que réimplémenté : le découpage
 * calendaire est une opération de DATE, pas de métier, et il sert aussi au
 * calendrier et aux compteurs. Une seconde implémentation dans le service
 * produirait tôt ou tard des périodes qui ne coïncident plus avec celles que
 * l'écran affiche.
 *
 * `ON_EVENT` rend un tableau VIDE : ces obligations naissent d'un fait, pas
 * d'un calendrier, et sont créées à la main. `CUSTOM` lit `occurrences[]` de la
 * règle.
 */
export {
  computePeriods,
  buildPeriodKey,
  endOfPeriod,
  startOfPeriod,
  type PeriodDescriptor,
  type PeriodRule,
} from "@/lib/dates";
