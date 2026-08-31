/**
 * Contrats de retour des actions du référentiel.
 *
 * Déclarés HORS du module « use server » : un tel fichier ne peut exporter que
 * des fonctions asynchrones. Y placer un type compile et construit sans
 * broncher, puis échoue à la première requête.
 */

import type { ClientError } from "@/lib/errors";
import type { RecalculationImpact } from "@/services/obligations";

/**
 * Branche d erreur seule.
 *
 * La garde de permission ne rend jamais de succes : la typer ActionOutcome<null>
 * la rendrait inassignable aux actions qui rendent un identifiant. Ce type-ci
 * est assignable a TOUT ActionOutcome<T>, quel que soit T.
 */
export type DeniedOutcome = { readonly status: "error"; readonly error: ClientError };

export type ActionOutcome<T> =
  | { readonly status: "success"; readonly data: T }
  | { readonly status: "error"; readonly error: ClientError };

export type SavedObligation = ActionOutcome<{ readonly id: string }>;
export type RecalculationPreview = ActionOutcome<RecalculationImpact>;
export type RecalculationApplied = ActionOutcome<{ readonly updated: number }>;
