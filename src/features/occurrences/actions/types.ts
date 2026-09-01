/**
 * Contrats de retour des actions de l'échéancier.
 *
 * Déclarés HORS du module « use server » : un tel fichier ne peut exporter que
 * des fonctions asynchrones. Y placer un type compile et construit sans
 * broncher, puis échoue à la première requête.
 */

import type { ClientError } from "@/lib/errors";
import type { ExportResult } from "@/services/occurrences/export";

export type DeniedOutcome = { readonly status: "error"; readonly error: ClientError };

export type ActionOutcome<T> =
  | { readonly status: "success"; readonly data: T }
  | { readonly status: "error"; readonly error: ClientError };

export type ReassignOutcome = ActionOutcome<{ readonly updated: number }>;
export type ExportOutcome = ActionOutcome<ExportResult>;
export type RememberOutcome = ActionOutcome<null>;
