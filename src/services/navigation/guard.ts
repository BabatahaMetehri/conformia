import "server-only";

/**
 * Garde de route des sections.
 *
 * ⚠️ Un accès refusé rend `notFound()`, PAS une page « accès refusé ».
 *
 * C'est la contrepartie applicative du cloisonnement de la RLS. Une page
 * « accès refusé » confirmerait l'existence de la ressource : un utilisateur du
 * domaine social apprendrait, du seul texte affiché, que le dossier fiscal
 * qu'il vient de deviner existe bel et bien. La base refuse déjà de faire cette
 * distinction — l'interface ne doit pas la rétablir.
 *
 * ⚠️ Cette garde ne protège pas la donnée : elle protège l'expérience et la
 * cohérence du discours. L'autorité reste la RLS. Un écran qui oublierait
 * d'appeler cette fonction ne verrait toujours aucune ligne.
 */

import { notFound } from "next/navigation";

import { canAccessPath } from "@/services/navigation";

export async function requireSectionAccess(path: string): Promise<void> {
  const allowed = await canAccessPath(path);
  if (!allowed) notFound();
}
