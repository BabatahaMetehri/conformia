import "server-only";

/**
 * Machine à états du cycle de vie d'une occurrence.
 *
 * ⚠️ AUCUNE TRANSITION N'EST DÉCLARÉE ICI, et aucune garde non plus. Ce module
 * ne contient pas de matrice, pas de `switch`, pas de `if (status === …)`. Il
 * pose une question à `evaluate_transition()` et traduit la réponse.
 *
 * C'est le point entier de la conception : la même fonction SQL décide pour
 * l'interface — qui grise un bouton et explique pourquoi — et pour l'écriture —
 * qui refuse. Une matrice recopiée en TypeScript serait une seconde source de
 * vérité, et l'expérience de ce projet est constante : deux sources finissent
 * par diverger, et c'est toujours la plus permissive qui gagne.
 *
 * Conséquence pratique : ajouter une transition au référentiel
 * `status_transition_rules` la rend disponible dans l'interface sans toucher à
 * une ligne de ce fichier.
 */

import {
  evaluateTransition,
  listTransitionRules,
  type TransitionRuleRow,
  type TransitionVerdict,
  type TransitionVerdictCode,
} from "@/data/queries/workflow";
import type { OccurrenceStatus } from "@/config/constants";
import { AppError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";

export type { TransitionRuleRow, TransitionVerdict, TransitionVerdictCode };

export interface TransitionContext {
  readonly reason?: string | null | undefined;
  readonly referenceNumber?: string | null | undefined;
  readonly lateReasonCode?: string | null | undefined;
}

/**
 * Clé i18n du refus.
 *
 * ⚠️ Une clé, jamais une phrase : le message visible appartient à `messages/`,
 * et le service ne rédige pas (CLAUDE.md §3.3). La table ci-dessous ne décide
 * de rien — elle nomme, dans la langue de l'interface, ce que la base a décidé.
 */
const REFUSAL_KEY: Readonly<Record<TransitionVerdictCode, string>> = {
  ALLOWED: "workflow.refusal.allowed",
  NO_CHANGE: "workflow.refusal.noChange",
  NOT_FOUND: "workflow.refusal.notFound",
  INVALID_TRANSITION: "workflow.refusal.invalidTransition",
  LOCKED: "workflow.refusal.locked",
  FORBIDDEN: "workflow.refusal.forbidden",
  REASON_REQUIRED: "workflow.refusal.reasonRequired",
  INCOMPLETE: "workflow.refusal.incomplete",
  SELF_VALIDATION_BLOCKED: "workflow.refusal.selfValidationBlocked",
  SECOND_LEVEL_REQUIRES_DIRECTION: "workflow.refusal.secondLevelRequiresDirection",
  REFERENCE_REQUIRED: "workflow.refusal.referenceRequired",
  PROOF_REQUIRED: "workflow.refusal.proofRequired",
  LATE_REASON_REQUIRED: "workflow.refusal.lateReasonRequired",
};

/**
 * Cette transition est-elle possible, et sinon pourquoi ?
 *
 * Rend `Result<void, AppError>` : l'erreur porte un code, une clé i18n et le
 * détail nécessaire à l'explication — les pièces manquantes, la permission
 * attendue, l'échéance dépassée. Jamais une phrase rédigée.
 */
export async function canTransition(
  occurrenceId: string,
  toStatus: OccurrenceStatus,
  context: TransitionContext = {},
): Promise<Result<void>> {
  const verdict = await evaluateTransition({
    occurrenceId,
    toStatus,
    reason: context.reason,
    referenceNumber: context.referenceNumber,
    lateReasonCode: context.lateReasonCode,
  });
  if (!verdict.ok) return verdict;

  if (verdict.value.outcome === "ALLOWED") return ok(undefined);

  return err(refusalError(verdict.value, toStatus));
}

/** Le verdict complet, quand l'appelant a besoin d'en montrer le détail. */
export async function describeTransition(
  occurrenceId: string,
  toStatus: OccurrenceStatus,
  context: TransitionContext = {},
): Promise<Result<TransitionVerdict>> {
  return evaluateTransition({
    occurrenceId,
    toStatus,
    reason: context.reason,
    referenceNumber: context.referenceNumber,
    lateReasonCode: context.lateReasonCode,
  });
}

function refusalError(verdict: TransitionVerdict, toStatus: OccurrenceStatus): AppError {
  const details: Record<string, unknown> = {
    reason: verdict.outcome,
    messageKey: REFUSAL_KEY[verdict.outcome],
    toStatus,
  };

  if (verdict.missing.length > 0) details["missing"] = verdict.missing;
  if (verdict.permission !== null) details["permission"] = verdict.permission;
  if (verdict.dueDate !== null) details["dueDate"] = verdict.dueDate;
  if (verdict.required !== null) details["required"] = verdict.required;
  if (verdict.obtained !== null) details["obtained"] = verdict.obtained;

  // Les refus se distinguent par leur NATURE : ce qu'on peut corriger soi-même
  // (une pièce manquante) n'est pas ce qu'on ne peut pas (une permission).
  switch (verdict.outcome) {
    case "NOT_FOUND":
      return AppError.notFound("occurrence", "", { details });
    case "FORBIDDEN":
    case "SELF_VALIDATION_BLOCKED":
    case "SECOND_LEVEL_REQUIRES_DIRECTION":
      return AppError.forbidden({ details });
    case "LOCKED":
      return AppError.periodLocked("", { details });
    case "INVALID_TRANSITION":
      return AppError.invalidTransition("", toStatus, { details });
    default:
      return AppError.validationFailed(details);
  }
}

/**
 * Transitions sortantes d'un état, telles que le RÉFÉRENTIEL les déclare.
 *
 * Sert à construire une barre d'actions sans jamais énumérer les statuts dans
 * du code : l'interface propose ce que la table contient.
 */
export async function outgoingTransitions(
  from: OccurrenceStatus,
): Promise<Result<readonly TransitionRuleRow[]>> {
  const rules = await listTransitionRules();
  if (!rules.ok) return rules;
  return ok(rules.value.filter((rule) => rule.fromStatus === from));
}

export async function getTransitionMatrix(): Promise<Result<readonly TransitionRuleRow[]>> {
  return listTransitionRules();
}
