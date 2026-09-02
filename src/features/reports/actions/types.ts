/**
 * Contrats de retour des actions d'export.
 *
 * Déclarés HORS d'un module « use server » : un tel fichier ne peut exporter que
 * des fonctions asynchrones. Y placer un type compile et construit sans broncher,
 * puis échoue à la première requête.
 */

import type { ClientError } from "@/lib/errors";
// ⚠️ Les types viennent du SERVICE, jamais de `src/data` : la couche UI ne
// traverse pas jusqu'aux données, même pour un type (CLAUDE.md §3.1).
import type { ExportRunView } from "@/services/export";

export type { ExportRunView };

export type ActionOutcome<T> =
  | { readonly status: "success"; readonly data: T }
  | { readonly status: "error"; readonly error: ClientError };

/** Un fichier produit en synchrone : l'octet est déjà là, encodé. */
export interface DownloadPayload {
  readonly fileName: string;
  readonly contentBase64: string;
  readonly mimeType: string;
  readonly rowCount: number;
  readonly occurrenceCount: number;
}

/**
 * Résultat d'une demande d'export de période.
 *
 * ⚠️ Deux formes, parce que l'utilisateur doit voir la différence : soit le
 * fichier arrive, soit on lui dit qu'il sera prévenu. Un écran qui ne
 * distinguerait pas les deux laisserait quelqu'un attendre un téléchargement qui
 * ne vient jamais.
 */
export type PeriodPlan =
  | { readonly mode: "SYNC"; readonly occurrenceCount: number }
  | { readonly mode: "ASYNC"; readonly runId: string; readonly occurrenceCount: number };

export type DownloadOutcome = ActionOutcome<DownloadPayload>;
export type PeriodOutcome = ActionOutcome<PeriodPlan>;
export type HistoryOutcome = ActionOutcome<readonly ExportRunView[]>;
