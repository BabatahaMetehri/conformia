import { describe, expect, it } from "vitest";

import {
  BULK_VALIDATABLE_CRITICALITIES,
  isBulkValidatable,
  sortQueue,
} from "@/lib/validation-priority";
import type { ValidationQueueRow } from "@/data/queries/workflow";

/**
 * Ordre de la file de validation, et périmètre de la validation groupée.
 *
 * Deux règles de PRIORISATION, pas d'autorisation : ce qu'un validateur a le
 * droit de voir est décidé par la vue `validation_queue` en base, et éprouvé
 * dans `tests/integration/workflow.test.ts`.
 */

const row = (
  over: Partial<ValidationQueueRow> & Pick<ValidationQueueRow, "id">,
): ValidationQueueRow => ({
  periodKey: "2026-03",
  legalDueDate: "2026-04-20",
  internalDueDate: "2026-04-15",
  version: 1,
  obligationCode: "G50",
  obligationName: "Déclaration",
  criticality: "LOW",
  validationLevels: 1,
  validationsObtained: 0,
  authorityName: null,
  ownerName: null,
  submittedForValidationAt: null,
  daysToInternal: 10,
  ...over,
});

describe("tri de la file", () => {
  it("place le plus URGENT en tête, avant toute considération de criticité", () => {
    /*
     * ⚠️ L'ordre des deux critères n'est pas indifférent. Une obligation mineure
     * DÉJÀ en retard passe devant une obligation critique à échéance lointaine :
     * la première est perdue si on ne la traite pas, la seconde ne l'est pas
     * encore. L'ordre inverse laisserait expirer les petites obligations en masse.
     */
    const sorted = sortQueue([
      row({ id: "critique-lointaine", criticality: "CRITICAL", daysToInternal: 30 }),
      row({ id: "mineure-en-retard", criticality: "LOW", daysToInternal: -3 }),
    ]);

    expect(sorted.map((entry) => entry.id)).toEqual(["mineure-en-retard", "critique-lointaine"]);
  });

  it("départage À ÉCHÉANCE ÉGALE par la criticité", () => {
    const sorted = sortQueue([
      row({ id: "faible", criticality: "LOW", daysToInternal: 5 }),
      row({ id: "critique", criticality: "CRITICAL", daysToInternal: 5 }),
      row({ id: "moyenne", criticality: "MEDIUM", daysToInternal: 5 }),
      row({ id: "haute", criticality: "HIGH", daysToInternal: 5 }),
    ]);

    expect(sorted.map((entry) => entry.id)).toEqual(["critique", "haute", "moyenne", "faible"]);
  });

  it("départage les ex æquo par l'échéance LÉGALE, pour un ordre stable", () => {
    // Sans ce troisième critère, deux dossiers identiques changeraient de place
    // d'un rendu à l'autre — et l'utilisateur cliquerait sur le mauvais.
    const sorted = sortQueue([
      row({ id: "tardive", daysToInternal: 5, legalDueDate: "2026-05-20" }),
      row({ id: "precoce", daysToInternal: 5, legalDueDate: "2026-04-20" }),
    ]);

    expect(sorted.map((entry) => entry.id)).toEqual(["precoce", "tardive"]);
  });

  it("ne modifie pas le tableau reçu", () => {
    const input = [row({ id: "b", daysToInternal: 9 }), row({ id: "a", daysToInternal: 1 })];
    sortQueue(input);
    expect(input.map((entry) => entry.id)).toEqual(["b", "a"]);
  });
});

describe("périmètre de la validation groupée", () => {
  it("admet la criticité faible et moyenne", () => {
    expect(isBulkValidatable("LOW")).toBe(true);
    expect(isBulkValidatable("MEDIUM")).toBe(true);
  });

  it("REFUSE la criticité haute et critique, sans exception", () => {
    // ⚠️ Valider en lot suppose qu'on n'a pas ouvert chaque dossier. Acceptable
    // pour une déclaration de routine ; jamais pour celles dont l'erreur se paie
    // en pénalités ou en responsabilité personnelle.
    expect(isBulkValidatable("HIGH")).toBe(false);
    expect(isBulkValidatable("CRITICAL")).toBe(false);
  });

  it("REFUSE une criticité inconnue plutôt que de l'admettre par défaut", () => {
    // Un nouveau niveau ajouté au référentiel ne doit pas devenir groupable
    // par accident : le défaut est le refus.
    expect(isBulkValidatable("INCONNUE")).toBe(false);
    expect(BULK_VALIDATABLE_CRITICALITIES).toHaveLength(2);
  });
});
