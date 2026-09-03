"use server";

/**
 * Server Actions des absences.
 *
 * ⚠️ AUCUNE ACTION DE SUPPRESSION. Une absence se RÉVOQUE (`revoked_at`).
 * L'effacer effacerait la raison pour laquelle un dossier a changé de mains, et
 * le journal des rappels renverrait à une explication disparue.
 */

import { revalidatePath } from "next/cache";

import { toClientError } from "@/lib/errors";
import type { Result } from "@/lib/result";
import { declareAbsence, revokeAbsenceEarly } from "@/services/absences";

export interface AbsenceActionResult {
  readonly status: "success" | "error";
  readonly error?: ReturnType<typeof toClientError>;
}

function revalidateAbsences(): void {
  revalidatePath("/[locale]/(app)/absences", "page");
  // Le tableau de bord porte l'indicateur « untel est absent » : le laisser
  // périmé afficherait une absence révoquée il y a une minute.
  revalidatePath("/[locale]/(app)/dashboard", "page");
}

function toOutcome(result: Result<{ readonly id: string }>): AbsenceActionResult {
  return result.ok
    ? { status: "success" }
    : { status: "error", error: toClientError(result.error) };
}

export async function declareAbsenceAction(input: unknown): Promise<AbsenceActionResult> {
  // ⚠️ Pas de garde de permission ICI : la règle est double — soi-même sans
  // permission, autrui avec `absence.manage` — et c'est le service qui la porte,
  // pour qu'elle ne soit écrite qu'une fois.
  const result = await declareAbsence(input);
  if (result.ok) revalidateAbsences();
  return toOutcome(result);
}

export async function revokeAbsenceAction(id: string): Promise<AbsenceActionResult> {
  const result = await revokeAbsenceEarly(id);
  if (result.ok) revalidateAbsences();
  return toOutcome(result);
}
