/**
 * Forme d'une ligne telle que l'interface la consomme.
 *
 * Déclarée dans la feature et non importée de `src/data` : la couche UI n'a pas
 * le droit de traverser jusqu'à la donnée (CLAUDE.md §3.1), et la page se charge
 * de la conversion.
 */

import type { Criticality, OccurrenceStatus } from "@/config/constants";

export interface OccurrenceRowView {
  readonly id: string;
  readonly obligationCode: string;
  readonly obligationName: string;
  readonly periodKey: string;
  readonly internalDueDate: string;
  readonly legalDueDate: string;
  readonly daysToInternal: number;
  readonly isOverdue: boolean;
  readonly isInternallyLate: boolean;
  readonly status: OccurrenceStatus;
  readonly ownerName: string | null;
  readonly validatorName: string | null;
  readonly documentsProvided: number;
  readonly documentsRequired: number;
  readonly criticality: Criticality;
  readonly rectificationIndex: number;
  readonly isLocked: boolean;
  readonly domainLabel: string | null;
  /**
   * Portée de l'obligation : `ENTITY` ou `PER_REGISTER`.
   *
   * ⚠️ SERT À SIGNALER « toute l'entreprise » quand un registre est filtré. Les
   * obligations d'entreprise RESTENT visibles sous un filtre par registre — la
   * TVA ne cesse pas d'être due parce qu'on regarde une annexe — et sans mention
   * la liste se lirait de travers : on croirait ces lignes rattachées à
   * l'établissement sélectionné.
   */
  readonly obligationScope: string;
  readonly registerNumber: string | null;
}

export interface AssignableProfile {
  readonly id: string;
  readonly fullName: string;
}
