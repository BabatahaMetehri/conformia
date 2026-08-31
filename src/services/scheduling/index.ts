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
