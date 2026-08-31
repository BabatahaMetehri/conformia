import "server-only";

/**
 * Désactivation d'un compte.
 *
 * Un compte n'est JAMAIS supprimé. Il devient inactif : il ne peut plus rien lire,
 * mais son nom continue d'apparaître dans les transitions qu'il a provoquées et sur
 * les pièces qu'il a déposées. Un audit dont les auteurs s'effacent ne prouve rien.
 *
 * Et il ne peut pas partir en laissant des dossiers sans titulaire : la
 * réaffectation est un préalable, pas une politesse.
 */

import { countOpenOccurrencesFor } from "@/data/queries/occurrences";
import { deactivateProfile, reassignOpenOccurrences } from "@/data/mutations/profiles";
import { AppError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { requirePermission } from "@/services/auth/context";
import type { ProfileId } from "@/types/domain";

export interface DeactivationRequest {
  readonly userId: ProfileId;
  /**
   * Destinataire des occurrences ouvertes. `null` n'est accepté que si
   * l'utilisateur n'en porte aucune — l'écran impose sinon de le désigner.
   */
  readonly reassignTo: ProfileId | null;
}

export interface DeactivationOutcome {
  readonly reassignedCount: number;
}

/**
 * Nombre d'occurrences ouvertes portées par un compte. L'interface l'appelle avant
 * d'afficher le formulaire, pour savoir s'il faut exiger un destinataire.
 */
export async function countBlockingOccurrences(userId: ProfileId): Promise<Result<number>> {
  const guard = await requirePermission("user.manage");
  if (!guard.ok) return guard;
  return countOpenOccurrencesFor(userId);
}

export async function deactivateUser(
  request: DeactivationRequest,
): Promise<Result<DeactivationOutcome>> {
  const guard = await requirePermission("user.manage");
  if (!guard.ok) return guard;

  if (request.userId === guard.value.userId) {
    return err(AppError.forbidden({ details: { reason: "SELF_DEACTIVATION" } }));
  }

  const open = await countOpenOccurrencesFor(request.userId);
  if (!open.ok) return open;

  let reassignedCount = 0;

  if (open.value > 0) {
    if (request.reassignTo === null) {
      // Refus explicite et chiffré : l'écran doit pouvoir dire combien de dossiers
      // attendent un destinataire, pas seulement que l'opération a échoué.
      return err(
        AppError.conflict({
          details: { reason: "OPEN_OCCURRENCES", openOccurrences: open.value },
        }),
      );
    }
    if (request.reassignTo === request.userId) {
      return err(AppError.validationFailed({ reassignTo: "SAME_AS_TARGET" }));
    }

    const reassigned = await reassignOpenOccurrences(request.userId, request.reassignTo);
    if (!reassigned.ok) return reassigned;
    reassignedCount = reassigned.value;
  }

  // Le trigger `prevent_orphan_deactivation` revérifie en base : si une occurrence
  // a été créée entre-temps, la désactivation échoue malgré ce qui précède.
  const deactivated = await deactivateProfile(request.userId, guard.value.userId);
  if (!deactivated.ok) return deactivated;

  return ok({ reassignedCount });
}
