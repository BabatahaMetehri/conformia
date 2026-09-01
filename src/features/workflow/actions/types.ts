/**
 * Contrats de retour des actions du circuit de validation.
 *
 * Déclarés HORS d'un module « use server » : un tel fichier ne peut exporter que
 * des fonctions asynchrones. Y placer un type compile et construit sans broncher,
 * puis échoue à la première requête.
 */

import type { ClientError } from "@/lib/errors";
// ⚠️ Les types viennent du SERVICE, jamais de `src/data` : la couche UI ne
// traverse pas jusqu'aux données, même pour un type (CLAUDE.md §3.1).
import type { TransitionOutcome } from "@/services/occurrences/detail";

export type ActionOutcome<T> =
  | { readonly status: "success"; readonly data: T }
  | { readonly status: "error"; readonly error: ClientError };

export type ValidationOutcome = ActionOutcome<TransitionOutcome>;
export type DelegationOutcome = ActionOutcome<{ readonly id: string }>;
export type PlainWorkflowOutcome = ActionOutcome<boolean>;

/** Résultat d'une validation groupée, dossier par dossier. */
export interface BulkEntry {
  readonly occurrenceId: string;
  readonly outcome: string;
}
export type BulkOutcome = ActionOutcome<{
  readonly applied: number;
  readonly refused: readonly BulkEntry[];
}>;

/** Vue réduite d'un dossier, pour décider sans quitter la file. */
export interface ReviewLine {
  readonly id: string;
  readonly label: string;
  readonly isMandatory: boolean;
  readonly hasDocument: boolean;
  readonly documentId: string | null;
  readonly documentName: string | null;
}

export interface ReviewStep {
  readonly id: string;
  readonly occurredAt: string;
  readonly actorName: string | null;
  readonly onBehalfOfName: string | null;
  readonly fromStatus: string | null;
  readonly toStatus: string | null;
  readonly reason: string | null;
}

export type ReviewOutcome = ActionOutcome<{
  readonly completeness: {
    readonly required: number;
    readonly provided: number;
    readonly missing: readonly string[];
    readonly isComplete: boolean;
  };
  readonly checklist: readonly ReviewLine[];
  readonly timeline: readonly ReviewStep[];
}>;
