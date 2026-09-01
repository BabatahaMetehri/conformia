/**
 * Contrats de retour des actions de la fiche.
 *
 * Déclarés HORS d'un module « use server » : un tel fichier ne peut exporter que
 * des fonctions asynchrones. Y placer un type compile et construit sans broncher,
 * puis échoue à la première requête.
 */

import type { ActionOutcome } from "@/features/occurrences/actions/types";
// ⚠️ Le type vient du SERVICE, jamais de `src/data` : la couche UI ne traverse pas
// jusqu'aux données, même pour un type (CLAUDE.md §3.1). Le service le réexporte.
import type { TransitionOutcome } from "@/services/occurrences/detail";

export type TransitionActionOutcome = ActionOutcome<TransitionOutcome>;
export type RectificationOutcome = ActionOutcome<{ readonly id: string }>;
export type CommentOutcome = ActionOutcome<{ readonly id: string }>;
export type PlainOutcome = ActionOutcome<null>;
export type DepositOutcome = ActionOutcome<{
  readonly documentId: string;
  readonly normalizedFilename: string;
  readonly version: number;
}>;
