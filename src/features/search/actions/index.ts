"use server";

/**
 * Action de recherche appelée par la palette ⌘K.
 *
 * Une Server Action plutôt qu'un Route Handler : la palette n'a pas besoin d'une
 * URL publique, et une action ne peut pas être appelée depuis l'extérieur de
 * l'application sans le jeton d'action de Next. Une route `/api/search` serait
 * une surface HTTP supplémentaire à protéger pour aucun gain.
 */

import { toClientError } from "@/lib/errors";
import { searchGlobally } from "@/services/search";
import type { SearchActionResult } from "@/features/search/actions/types";

export async function searchAction(query: string): Promise<SearchActionResult> {
  const result = await searchGlobally(query);

  if (!result.ok) {
    // `toClientError` retire `cause` : l'erreur Postgres d'origine ne traverse
    // jamais la frontière.
    return { status: "error", error: toClientError(result.error) };
  }

  return { status: "success", outcome: result.value };
}
