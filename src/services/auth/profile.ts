import "server-only";

/**
 * Fiche « Mon profil » — assemblage.
 *
 * Le contexte de session porte les droits ; cette fonction y ajoute les
 * libellés. Elle existe pour tenir la frontière de couches : l'interface
 * n'atteint jamais `data/` directement (CLAUDE.md §3.1).
 */

import { loadProfileLabels, type ProfileLabels } from "@/data/queries/profile";
import type { Result } from "@/lib/result";

export type { ProfileLabels };

export async function getProfileLabels(
  departmentId: string | null,
): Promise<Result<ProfileLabels>> {
  return loadProfileLabels(departmentId);
}
