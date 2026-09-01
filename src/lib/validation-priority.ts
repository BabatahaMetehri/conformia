/**
 * Priorisation de la file de validation.
 *
 * Fonctions PURES, isolées du service qui les emploie : celui-ci est marqué
 * `server-only` et serait donc intestable ailleurs que dans un processus
 * serveur. Les RÈGLES, elles, doivent pouvoir être éprouvées seules — ce sont
 * elles qui décident de l'ordre dans lequel un validateur voit son travail.
 *
 * ⚠️ Aucune de ces fonctions n'accorde ni ne refuse un droit. Ce qu'un
 * validateur peut voir est décidé par la vue `validation_queue` en base ; ce
 * qu'il peut valider l'est par `evaluate_transition`.
 */

import { Criticality } from "@/config/constants";

/**
 * Criticités pour lesquelles la validation GROUPÉE est admise.
 *
 * ⚠️ Décision arrêtée, et volontairement restrictive : jamais HIGH, jamais
 * CRITICAL. Valider en lot suppose qu'on n'a pas ouvert chaque dossier ; c'est
 * acceptable pour une déclaration de routine, jamais pour celles dont l'erreur
 * se paie en pénalités ou en responsabilité personnelle.
 */
export const BULK_VALIDATABLE_CRITICALITIES: readonly string[] = [
  Criticality.LOW,
  Criticality.MEDIUM,
];

export function isBulkValidatable(criticality: string): boolean {
  return BULK_VALIDATABLE_CRITICALITIES.includes(criticality);
}

/** Poids de tri : plus il est petit, plus le dossier passe devant. */
const CRITICALITY_RANK: Readonly<Record<string, number>> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

/** Forme minimale exigée pour trier : le tri ne connaît pas la ligne entière. */
export interface Prioritisable {
  readonly daysToInternal: number;
  readonly criticality: string;
  readonly legalDueDate: string;
}

/**
 * Tri par URGENCE, puis par CRITICITÉ, puis par échéance légale.
 *
 * ⚠️ L'ordre des deux premiers critères n'est pas indifférent. Une obligation
 * mineure DÉJÀ en retard passe devant une obligation critique à échéance
 * lointaine : la première est perdue si personne ne la traite, la seconde ne
 * l'est pas encore. L'ordre inverse laisserait expirer les petites obligations
 * en masse pendant qu'on soigne les grandes.
 *
 * Le troisième critère n'est pas décoratif : sans lui, deux dossiers ex æquo
 * changeraient de place d'un rendu à l'autre, et l'utilisateur cliquerait sur
 * le mauvais.
 */
export function sortQueue<T extends Prioritisable>(rows: readonly T[]): readonly T[] {
  return [...rows].sort((left, right) => {
    if (left.daysToInternal !== right.daysToInternal) {
      return left.daysToInternal - right.daysToInternal;
    }
    const leftRank = CRITICALITY_RANK[left.criticality] ?? 9;
    const rightRank = CRITICALITY_RANK[right.criticality] ?? 9;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.legalDueDate.localeCompare(right.legalDueDate);
  });
}
