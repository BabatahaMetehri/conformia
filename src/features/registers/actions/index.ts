"use server";

/**
 * Server Actions des registres de commerce.
 *
 * Chaîne imposée, dans cet ordre : permission → validation Zod → service →
 * revalidatePath → Result sérialisable.
 *
 * ⚠️ Le contrôle de permission est DANS l'action, pas seulement dans l'écran.
 * Masquer un bouton n'a jamais protégé quoi que ce soit : une Server Action est
 * un point d'entrée HTTP à part entière, appelable depuis la console du
 * navigateur. Le service revérifie, et la RLS refuse en dernier ressort.
 *
 * ⚠️ AUCUNE ACTION DE SUPPRESSION, et il n'y en aura pas. Un registre se RADIE —
 * on passe son statut à `RADIE`. L'effacer emporterait le rattachement des
 * dossiers qu'il a produits, et l'entreprise perdrait la preuve de
 * l'établissement pour lequel elle les a déposés.
 */

import { revalidatePath } from "next/cache";

import { toClientError } from "@/lib/errors";
import type { Result } from "@/lib/result";
import { requirePermission } from "@/services/auth/context";
import { createRegister, updateRegister } from "@/services/registers";

export interface RegisterActionResult {
  readonly status: "success" | "error" | "denied";
  readonly id?: string;
  readonly error?: ReturnType<typeof toClientError>;
}

const LIST_PATH = "/[locale]/(app)/registres";
const DETAIL_PATH = "/[locale]/(app)/registres/[registerId]";

function revalidateRegisters(): void {
  revalidatePath(LIST_PATH, "page");
  revalidatePath(DETAIL_PATH, "page");
  /*
   * ⚠️ L'échéancier aussi : son filtre « registre » propose la liste des
   * registres, et un établissement créé qui n'y apparaît pas passerait pour un
   * enregistrement raté.
   */
  revalidatePath("/[locale]/(app)/echeancier", "page");
}

function toOutcome(result: Result<{ readonly id: string }>): RegisterActionResult {
  // `toClientError` retire `cause` : l'erreur Postgres d'origine ne traverse
  // jamais la frontière (CLAUDE.md §3.3).
  return result.ok
    ? { status: "success", id: result.value.id }
    : { status: "error", error: toClientError(result.error) };
}

export async function createRegisterAction(input: unknown): Promise<RegisterActionResult> {
  const guard = await requirePermission("register.manage");
  if (!guard.ok) return { status: "denied" };

  const result = await createRegister(input);
  if (result.ok) revalidateRegisters();
  return toOutcome(result);
}

export async function updateRegisterAction(
  id: string,
  input: unknown,
): Promise<RegisterActionResult> {
  const guard = await requirePermission("register.manage");
  if (!guard.ok) return { status: "denied" };

  const result = await updateRegister(id, input);
  if (result.ok) revalidateRegisters();
  return toOutcome(result);
}
