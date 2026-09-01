import "server-only";

/**
 * Écritures sur les occurrences.
 *
 * Toute écriture déclenche `audit_trigger()` : acteur, avant, après et champs
 * modifiés sont journalisés par la base (cf. CLAUDE.md §3.6).
 */

import { mapPostgrestError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ProfileId } from "@/types/domain";

/**
 * Réaffectation groupée, en UNE transaction.
 *
 * ⚠️ Passe par `reassign_occurrences()`. Une boucle applicative ferait autant
 * d'allers-retours que de lignes, et un incident au milieu laisserait la moitié
 * du lot dans l'ancien état. Les bornes (dossier non verrouillé, non clos,
 * visible par l'appelant) sont posées EN BASE.
 */
export async function reassignOccurrenceBatch(
  occurrenceIds: readonly string[],
  ownerId: ProfileId,
): Promise<Result<number>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("reassign_occurrences", {
    p_occurrence_ids: occurrenceIds as string[],
    p_owner_id: ownerId,
  });

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data);
}
