/**
 * Complétude d'un dossier — fonction PURE.
 *
 * ⚠️ Pas de `server-only` : la barre d'actions calcule la même complétude côté
 * client pour désactiver « Soumettre à validation » et nommer ce qui manque,
 * avant même d'appeler le serveur. Une seconde implémentation côté client
 * finirait par diverger de celle qui refuse réellement.
 *
 * Ce calcul est la FAÇADE. L'autorité reste la base : `occurrence_missing_items()`
 * refait le même travail dans `apply_occurrence_transition()`, et c'est elle qui
 * décide. Ici on explique à l'utilisateur ; là-bas on refuse.
 *
 * Règle unique : une pièce obligatoire est fournie quand un document VIVANT lui
 * est rattaché. Aucune case à cocher n'entre dans ce calcul.
 */

export interface ChecklistItemInput {
  readonly id: string;
  readonly label: string;
  readonly isMandatory: boolean;
  readonly orderIndex: number;
}

export interface AttachedDocumentInput {
  readonly checklistItemId: string | null;
  readonly deletedAt: string | null;
}

export interface Completeness {
  readonly required: number;
  readonly provided: number;
  readonly missing: readonly string[];
  readonly isComplete: boolean;
  /** Identifiants des lignes satisfaites — l'interface coche à partir de là. */
  readonly satisfiedItemIds: ReadonlySet<string>;
}

export function computeCompleteness(
  items: readonly ChecklistItemInput[],
  documents: readonly AttachedDocumentInput[],
): Completeness {
  const satisfied = new Set<string>();
  for (const document of documents) {
    if (document.deletedAt !== null) continue;
    if (document.checklistItemId === null) continue;
    satisfied.add(document.checklistItemId);
  }

  const mandatory = items.filter((item) => item.isMandatory);
  const missing = [...mandatory]
    .filter((item) => !satisfied.has(item.id))
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .map((item) => item.label);

  return {
    required: mandatory.length,
    provided: mandatory.length - missing.length,
    missing,
    isComplete: missing.length === 0,
    satisfiedItemIds: satisfied,
  };
}
