/**
 * Contrat de retour de l'action de recherche.
 *
 * Déclaré HORS du module « use server » : un tel fichier ne peut exporter que
 * des fonctions asynchrones. Y laisser un type compile et construit sans
 * broncher, puis échoue à la première requête.
 */

import type { ClientError } from "@/lib/errors";
import type { SearchOutcome } from "@/services/search";

export type SearchActionResult =
  | { readonly status: "success"; readonly outcome: SearchOutcome }
  | { readonly status: "error"; readonly error: ClientError };
