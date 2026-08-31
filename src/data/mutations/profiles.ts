import "server-only";

/**
 * Écritures sur les comptes.
 *
 * Un compte n'est JAMAIS supprimé : il est désactivé. Son nom continue d'apparaître
 * dans les traces et sur les documents qu'il a déposés — un audit dont les auteurs
 * s'effacent ne prouve plus rien.
 */

import { mapPostgrestError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ProfileId } from "@/types/domain";

/**
 * Réaffecte en bloc les occurrences ouvertes d'un utilisateur.
 * Précède toute désactivation : le trigger `prevent_orphan_deactivation` refuse
 * de laisser un dossier sans titulaire.
 */
export async function reassignOpenOccurrences(
  fromUserId: ProfileId,
  toUserId: ProfileId,
): Promise<Result<number>> {
  const supabase = await createSupabaseServerClient();
  // Un dossier SUBMITTED ou ARCHIVED n'attend plus rien de son titulaire : il n'a
  // pas à être réaffecté, et son historique doit continuer de nommer l'auteur réel.
  const OPEN_STATUSES = [
    "TODO",
    "IN_PROGRESS",
    "PENDING_VALIDATION",
    "REJECTED",
    "VALIDATED",
  ] as const;

  const { data: owned, error: ownerError } = await supabase
    .from("obligation_occurrences")
    .update({ owner_id: toUserId })
    .eq("owner_id", fromUserId)
    .is("deleted_at", null)
    .in("status", OPEN_STATUSES)
    .select("id");

  if (ownerError !== null) return err(mapPostgrestError(ownerError));

  const { data: validated, error: validatorError } = await supabase
    .from("obligation_occurrences")
    .update({ validator_id: toUserId })
    .eq("validator_id", fromUserId)
    .is("deleted_at", null)
    .in("status", OPEN_STATUSES)
    .select("id");

  if (validatorError !== null) return err(mapPostgrestError(validatorError));

  return ok(owned.length + validated.length);
}

export async function deactivateProfile(
  userId: ProfileId,
  deactivatedBy: ProfileId,
): Promise<Result<null>> {
  const supabase = await createSupabaseServerClient();

  // Le refus en cas d'occurrences ouvertes vient du trigger, pas d'ici : une
  // désactivation faite par script doit buter sur la même barrière.
  const { error } = await supabase
    .from("profiles")
    .update({
      is_active: false,
      deactivated_at: new Date().toISOString(),
      deactivated_by: deactivatedBy,
    })
    .eq("id", userId);

  if (error !== null) return err(mapPostgrestError(error));
  return ok(null);
}

export async function reactivateProfile(userId: ProfileId): Promise<Result<null>> {
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("profiles")
    .update({ is_active: true, deactivated_at: null, deactivated_by: null })
    .eq("id", userId);

  if (error !== null) return err(mapPostgrestError(error));
  return ok(null);
}

export async function touchLastLogin(userId: ProfileId): Promise<Result<null>> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("profiles")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", userId);

  if (error !== null) return err(mapPostgrestError(error));
  return ok(null);
}

export async function setMfaEnrolled(userId: ProfileId, enrolled: boolean): Promise<Result<null>> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("profiles")
    .update({ mfa_enrolled: enrolled })
    .eq("id", userId);

  if (error !== null) return err(mapPostgrestError(error));
  return ok(null);
}
