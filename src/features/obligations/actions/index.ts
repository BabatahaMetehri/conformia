"use server";

/**
 * Server Actions du référentiel.
 *
 * Chaîne imposée, dans cet ordre, pour chacune :
 *   permission → validation Zod → service → revalidatePath → Result sérialisable.
 *
 * ⚠️ Le contrôle de permission est DANS l'action, pas seulement dans l'écran.
 * Masquer un bouton n'a jamais protégé quoi que ce soit : une Server Action est
 * un point d'entrée HTTP à part entière, appelable depuis la console du
 * navigateur. Le service revérifie (`requirePermission`), et la RLS refuse en
 * dernier ressort. Trois barrières, dont la dernière seule est infranchissable.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AppError, toClientError } from "@/lib/errors";
import type { Result } from "@/lib/result";
import {
  applyRuleChange,
  createObligationType,
  deactivateObligationType,
  deleteObligationType,
  duplicateObligationType,
  countPropagableOccurrences,
  previewRuleChange,
  reactivateObligationType,
  saveObligationAssignment,
  updateObligationType,
  DuplicateObligationSchema,
  ToggleActiveSchema,
} from "@/services/obligations";
import { uuidSchema } from "@/lib/schemas";
import { requirePermission } from "@/services/auth/context";
import type {
  ActionOutcome,
  DeniedOutcome,
  RecalculationApplied,
  RecalculationPreview,
  SavedObligation,
} from "@/features/obligations/actions/types";

/** Chemins à rafraîchir après toute écriture du référentiel. */
const LIST_PATH = "/[locale]/(app)/referentiel";
const DETAIL_PATH = "/[locale]/(app)/referentiel/[obligationId]";

function toOutcome<T>(result: Result<T>): ActionOutcome<T> {
  // `toClientError` retire `cause` : l'erreur Postgres d'origine ne traverse
  // jamais la frontière (CLAUDE.md §3.3).
  return result.ok
    ? { status: "success", data: result.value }
    : { status: "error", error: toClientError(result.error) };
}

function revalidateReferential(): void {
  revalidatePath(LIST_PATH, "page");
  revalidatePath(DETAIL_PATH, "page");
}

/**
 * Garde commune. Répétée en tête de chaque action plutôt que factorisée dans un
 * enrobage : un enrobage oublié sur une seule action ne se voit pas à la
 * relecture, une ligne manquante si.
 */
async function guard(): Promise<DeniedOutcome | null> {
  const context = await requirePermission("referential.manage");
  return context.ok ? null : { status: "error", error: toClientError(context.error) };
}

export async function createObligationAction(input: unknown): Promise<SavedObligation> {
  const denied = await guard();
  if (denied !== null) return denied;

  const result = await createObligationType(input);
  if (result.ok) revalidateReferential();
  return toOutcome(result);
}

export async function updateObligationAction(input: unknown): Promise<SavedObligation> {
  const denied = await guard();
  if (denied !== null) return denied;

  const result = await updateObligationType(input);
  if (result.ok) revalidateReferential();
  return toOutcome(result);
}

export async function toggleObligationActiveAction(input: unknown): Promise<SavedObligation> {
  const denied = await guard();
  if (denied !== null) return denied;

  const parsed = ToggleActiveSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      error: { code: "VALIDATION_FAILED", message: "errors.validationFailed", httpStatus: 422 },
    };
  }

  const result = parsed.data.is_active
    ? await reactivateObligationType(parsed.data.id)
    : await deactivateObligationType(parsed.data.id);

  if (result.ok) revalidateReferential();
  return toOutcome(result);
}

export async function duplicateObligationAction(input: unknown): Promise<SavedObligation> {
  const denied = await guard();
  if (denied !== null) return denied;

  const parsed = DuplicateObligationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      error: { code: "VALIDATION_FAILED", message: "errors.validationFailed", httpStatus: 422 },
    };
  }

  const result = await duplicateObligationType(parsed.data);
  if (result.ok) revalidateReferential();
  return toOutcome(result);
}

export async function deleteObligationAction(id: string): Promise<SavedObligation> {
  const denied = await guard();
  if (denied !== null) return denied;

  const result = await deleteObligationType(id);
  if (result.ok) revalidateReferential();
  return toOutcome(result);
}

/**
 * Impact d'un changement de règle. LECTURE SEULE — aucune écriture, aucune
 * revalidation : c'est ce qui alimente la fenêtre de confirmation.
 */
export async function previewRuleChangeAction(
  id: string,
  rule: unknown,
  periodicity?: string,
): Promise<RecalculationPreview> {
  const denied = await guard();
  if (denied !== null) return denied;

  return toOutcome(await previewRuleChange(id, rule, periodicity));
}

/**
 * Applique le recalcul.
 *
 * L'impact est RECALCULÉ côté serveur : les lignes affichées dans la fenêtre de
 * confirmation ne sont pas renvoyées par le client. Sans cela, un appel forgé
 * pourrait imposer n'importe quelle date à n'importe quelle occurrence.
 */
export async function applyRuleChangeAction(
  id: string,
  rule: unknown,
  periodicity?: string,
): Promise<RecalculationApplied> {
  const denied = await guard();
  if (denied !== null) return denied;

  const result = await applyRuleChange(id, rule, periodicity);
  if (result.ok) revalidateReferential();
  return toOutcome(result);
}

// ─── Affectations par défaut ─────────────────────────────────────────────────

const AssignmentSchema = z.object({
  obligationTypeId: uuidSchema,
  ownerId: uuidSchema.nullable().default(null),
  deputyId: uuidSchema.nullable().default(null),
  validatorId: uuidSchema.nullable().default(null),
  propagate: z.boolean().default(false),
});

/**
 * Nombre de dossiers qu'une propagation toucherait.
 *
 * ⚠️ Appelée AVANT l'enregistrement, pour que la confirmation annonce un nombre
 * exact. Elle ne modifie rien : c'est une lecture, et son échec ne doit pas
 * empêcher d'enregistrer sans propager.
 */
export async function countPropagableAction(
  obligationTypeId: unknown,
): Promise<ActionOutcome<{ readonly count: number }>> {
  const guard = await requirePermission("occurrence.assign");
  if (!guard.ok) return { status: "error", error: toClientError(guard.error) };

  const parsed = uuidSchema.safeParse(obligationTypeId);
  if (!parsed.success) {
    return {
      status: "error",
      error: toClientError(AppError.validationFailed({ id: "MALFORMED" })),
    };
  }

  const result = await countPropagableOccurrences(parsed.data);
  return result.ok
    ? { status: "success", data: { count: result.value } }
    : { status: "error", error: toClientError(result.error) };
}

export async function saveAssignmentAction(
  input: unknown,
): Promise<ActionOutcome<{ readonly propagated: number }>> {
  const guard = await requirePermission("referential.manage");
  if (!guard.ok) return { status: "error", error: toClientError(guard.error) };

  const parsed = AssignmentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      error: toClientError(AppError.validationFailed({ reason: "ASSIGNMENT_MALFORMED" })),
    };
  }

  const result = await saveObligationAssignment(parsed.data);
  if (result.ok) {
    revalidateReferential();
    // L'échéancier porte les affectations : une propagation qui n'y apparaît pas
    // ferait douter qu'elle ait eu lieu.
    revalidatePath("/[locale]/(app)/echeancier", "page");
  }

  return toOutcome(result);
}
