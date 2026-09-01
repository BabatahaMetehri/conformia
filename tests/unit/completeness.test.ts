import { describe, expect, it } from "vitest";

import { computeCompleteness } from "@/services/occurrences/completeness";

/**
 * Complétude d'un dossier.
 *
 * ⚠️ La règle testée ici est la MÊME que celle appliquée par
 * `occurrence_missing_items()` en base — vérifiée, elle, dans
 * `tests/integration/occurrence-detail.test.ts`. Les deux doivent rester
 * d'accord : celle-ci explique à l'utilisateur, celle-là refuse.
 */

const item = (id: string, label: string, isMandatory: boolean, orderIndex: number) => ({
  id,
  label,
  isMandatory,
  orderIndex,
});

describe("computeCompleteness", () => {
  it("ne compte QUE les pièces obligatoires", () => {
    const result = computeCompleteness(
      [item("a", "Bordereau", true, 1), item("b", "Annexe", false, 2)],
      [],
    );

    expect(result.required).toBe(1);
    expect(result.missing).toEqual(["Bordereau"]);
  });

  it("nomme les pièces manquantes DANS L'ORDRE de la liste de contrôle", () => {
    // L'ordre importe : c'est celui dans lequel l'utilisateur voit ses lignes.
    const result = computeCompleteness(
      [
        item("c", "Troisième", true, 3),
        item("a", "Première", true, 1),
        item("b", "Deuxième", true, 2),
      ],
      [],
    );

    expect(result.missing).toEqual(["Première", "Deuxième", "Troisième"]);
  });

  it("considère une pièce fournie dès qu'un document vivant y est rattaché", () => {
    const result = computeCompleteness(
      [item("a", "Bordereau", true, 1)],
      [{ checklistItemId: "a", deletedAt: null }],
    );

    expect(result).toMatchObject({ required: 1, provided: 1, missing: [], isComplete: true });
  });

  it("ignore un document RETIRÉ — le dossier redevient incomplet", () => {
    const result = computeCompleteness(
      [item("a", "Bordereau", true, 1)],
      [{ checklistItemId: "a", deletedAt: "2026-03-01T10:00:00Z" }],
    );

    expect(result.isComplete).toBe(false);
    expect(result.missing).toEqual(["Bordereau"]);
  });

  it("ignore un document rattaché à AUCUNE ligne", () => {
    // Une pièce libre déposée dans l'onglet Documents ne satisfait aucune
    // exigence : sinon n'importe quel fichier débloquerait la soumission.
    const result = computeCompleteness(
      [item("a", "Bordereau", true, 1)],
      [{ checklistItemId: null, deletedAt: null }],
    );

    expect(result.isComplete).toBe(false);
  });

  it("plusieurs versions d'une même pièce ne comptent qu'une fois", () => {
    const result = computeCompleteness(
      [item("a", "Bordereau", true, 1)],
      [
        { checklistItemId: "a", deletedAt: null },
        { checklistItemId: "a", deletedAt: null },
      ],
    );

    expect(result.provided).toBe(1);
  });

  it("un dossier sans aucune pièce attendue est complet", () => {
    const result = computeCompleteness([], []);
    expect(result).toMatchObject({ required: 0, provided: 0, isComplete: true });
  });

  it("expose les lignes satisfaites, pour cocher sans recalculer", () => {
    const result = computeCompleteness(
      [item("a", "Bordereau", true, 1), item("b", "Annexe", false, 2)],
      [{ checklistItemId: "b", deletedAt: null }],
    );

    expect([...result.satisfiedItemIds]).toEqual(["b"]);
    // La facultative satisfaite ne gonfle PAS le compteur des obligatoires.
    expect(result.provided).toBe(0);
    expect(result.required).toBe(1);
  });
});
