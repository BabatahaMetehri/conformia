// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/lib/result";
import { AppError } from "@/lib/errors";
import type { TransitionVerdict, TransitionVerdictCode } from "@/data/queries/workflow";

/**
 * Machine à états — la TRADUCTION du verdict, éprouvée code par code.
 *
 * ⚠️ Ce module ne décide de RIEN : `evaluate_transition()` décide, en base, et
 * c'est le test d'intégration `workflow.test.ts` qui éprouve la matrice
 * elle-même. Ce qui se teste ICI est l'autre moitié du contrat : que chaque
 * verdict rendu par la base devienne l'erreur applicative juste.
 *
 * ⚠️ POURQUOI CETTE DISTINCTION COMPTE. Un refus mal traduit se voit à
 * l'affichage : un manque de permission présenté comme une pièce manquante
 * envoie l'utilisateur chercher un document qui n'existe pas, et un refus de
 * validation croisée présenté comme une erreur de saisie lui fait recommencer
 * indéfiniment. Le code d'erreur choisi ici décide de ce que l'écran raconte.
 */

const evaluateTransition = vi.fn();
const listTransitionRules = vi.fn();

vi.mock("@/data/queries/workflow", () => ({
  evaluateTransition: (...args: unknown[]) => evaluateTransition(...args) as unknown,
  listTransitionRules: (...args: unknown[]) => listTransitionRules(...args) as unknown,
}));

const { canTransition, describeTransition, getTransitionMatrix, outgoingTransitions } =
  await import("@/services/workflow/state-machine");

function verdict(overrides: Partial<TransitionVerdict> = {}): TransitionVerdict {
  return {
    outcome: "ALLOWED",
    missing: [],
    permission: null,
    dueDate: null,
    required: null,
    obtained: null,
    ...overrides,
  } as TransitionVerdict;
}

beforeEach(() => {
  evaluateTransition.mockReset();
  listTransitionRules.mockReset();
});

// ═════════════════════════════════════════════════════════════════════════════

describe("verdict favorable", () => {
  it("ALLOWED passe sans erreur", async () => {
    evaluateTransition.mockResolvedValue(ok(verdict({ outcome: "ALLOWED" })));
    await expect(canTransition("id", "IN_PROGRESS")).resolves.toEqual(ok(undefined));
  });

  it("transmet le contexte à la base, sans le réinterpréter", async () => {
    evaluateTransition.mockResolvedValue(ok(verdict()));

    await canTransition("id", "SUBMITTED", {
      reason: "Motif suffisamment explicite.",
      referenceNumber: "REF-42",
      lateReasonCode: "OVERSIGHT",
    });

    // Le service ne juge ni le motif ni la référence : il les passe. Toute règle
    // appliquée ici serait une seconde source de vérité.
    expect(evaluateTransition).toHaveBeenCalledWith({
      occurrenceId: "id",
      toStatus: "SUBMITTED",
      reason: "Motif suffisamment explicite.",
      referenceNumber: "REF-42",
      lateReasonCode: "OVERSIGHT",
    });
  });

  it("appelle la base même sans contexte", async () => {
    evaluateTransition.mockResolvedValue(ok(verdict()));
    await canTransition("id", "TODO");

    expect(evaluateTransition).toHaveBeenCalledWith({
      occurrenceId: "id",
      toStatus: "TODO",
      reason: undefined,
      referenceNumber: undefined,
      lateReasonCode: undefined,
    });
  });
});

describe("propagation d'un échec de lecture", () => {
  it("rend l'erreur de la base telle quelle", async () => {
    // Une base injoignable n'est pas un refus métier : la confondre avec un
    // « transition interdite » ferait croire à une règle qui n'existe pas.
    const failure = err(AppError.internal());
    evaluateTransition.mockResolvedValue(failure);

    await expect(canTransition("id", "VALIDATED")).resolves.toEqual(failure);
  });
});

describe("traduction de CHAQUE code de refus", () => {
  /**
   * ⚠️ La table est exhaustive par construction : `TransitionVerdictCode` la
   * type, donc un code ajouté à l'énumération sans ligne ici ne compile pas.
   * C'est la seule façon d'empêcher un refus non traduit d'atteindre l'écran.
   */
  const EXPECTED: Readonly<Record<Exclude<TransitionVerdictCode, "ALLOWED">, string>> = {
    NO_CHANGE: "VALIDATION_FAILED",
    NOT_FOUND: "NOT_FOUND",
    INVALID_TRANSITION: "INVALID_TRANSITION",
    LOCKED: "PERIOD_LOCKED",
    FORBIDDEN: "FORBIDDEN",
    REASON_REQUIRED: "VALIDATION_FAILED",
    INCOMPLETE: "VALIDATION_FAILED",
    SELF_VALIDATION_BLOCKED: "FORBIDDEN",
    SECOND_LEVEL_REQUIRES_DIRECTION: "FORBIDDEN",
    REFERENCE_REQUIRED: "VALIDATION_FAILED",
    PROOF_REQUIRED: "VALIDATION_FAILED",
    LATE_REASON_REQUIRED: "VALIDATION_FAILED",
  };

  for (const [outcome, expectedCode] of Object.entries(EXPECTED)) {
    it(`${outcome} devient ${expectedCode}`, async () => {
      evaluateTransition.mockResolvedValue(
        ok(verdict({ outcome: outcome as TransitionVerdictCode })),
      );

      const result = await canTransition("id", "VALIDATED");

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe(expectedCode);
      // La clé i18n voyage dans le détail : le service nomme, il ne rédige pas.
      expect(result.error.details?.["messageKey"]).toBe(
        `workflow.refusal.${outcome.charAt(0).toLowerCase()}${outcome
          .slice(1)
          .toLowerCase()
          .replaceAll(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase())}`,
      );
      expect(result.error.details?.["reason"]).toBe(outcome);
      expect(result.error.details?.["toStatus"]).toBe("VALIDATED");
    });
  }
});

describe("détail du refus", () => {
  it("porte les pièces manquantes quand il y en a", async () => {
    evaluateTransition.mockResolvedValue(
      ok(verdict({ outcome: "INCOMPLETE", missing: ["Bordereau", "Justificatif"] })),
    );

    const result = await canTransition("id", "PENDING_VALIDATION");
    expect(result.ok).toBe(false);
    if (result.ok) return;

    // Sans la liste, l'écran dirait « dossier incomplet » sans dire de quoi.
    expect(result.error.details?.["missing"]).toEqual(["Bordereau", "Justificatif"]);
  });

  it("OMET les champs vides plutôt que de les porter à null", async () => {
    evaluateTransition.mockResolvedValue(ok(verdict({ outcome: "REASON_REQUIRED" })));

    const result = await canTransition("id", "REJECTED");
    expect(result.ok).toBe(false);
    if (result.ok) return;

    // Un détail à `null` se lit « la valeur est nulle » ; son absence se lit
    // « sans objet ». La nuance décide de ce que l'écran affiche.
    expect(result.error.details).not.toHaveProperty("missing");
    expect(result.error.details).not.toHaveProperty("permission");
    expect(result.error.details).not.toHaveProperty("dueDate");
  });

  it("porte la permission attendue, l'échéance et les niveaux de validation", async () => {
    evaluateTransition.mockResolvedValue(
      ok(
        verdict({
          outcome: "SECOND_LEVEL_REQUIRES_DIRECTION",
          permission: "occurrence.validate",
          dueDate: "2026-02-20",
          required: 2,
          obtained: 1,
        }),
      ),
    );

    const result = await canTransition("id", "VALIDATED");
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.details?.["permission"]).toBe("occurrence.validate");
    expect(result.error.details?.["dueDate"]).toBe("2026-02-20");
    expect(result.error.details?.["required"]).toBe(2);
    expect(result.error.details?.["obtained"]).toBe(1);
  });

  it("porte `obtained` même à zéro", async () => {
    // Zéro validation obtenue est une information ; l'omettre laisserait croire
    // que le compte n'a pas été fait.
    evaluateTransition.mockResolvedValue(
      ok(verdict({ outcome: "FORBIDDEN", required: 2, obtained: 0 })),
    );

    const result = await canTransition("id", "VALIDATED");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.details?.["obtained"]).toBe(0);
  });
});

describe("verdict complet", () => {
  it("rend le verdict brut, refus compris", async () => {
    const value = verdict({ outcome: "INCOMPLETE", missing: ["Bordereau"] });
    evaluateTransition.mockResolvedValue(ok(value));

    // L'appelant qui veut MONTRER le détail — une barre d'actions qui grise un
    // bouton et explique pourquoi — a besoin du verdict, pas d'une erreur.
    await expect(describeTransition("id", "PENDING_VALIDATION")).resolves.toEqual(ok(value));
  });

  it("transmet le contexte", async () => {
    evaluateTransition.mockResolvedValue(ok(verdict()));
    await describeTransition("id", "SUBMITTED", { referenceNumber: "REF-7" });

    expect(evaluateTransition).toHaveBeenCalledWith(
      expect.objectContaining({ referenceNumber: "REF-7" }),
    );
  });
});

describe("transitions sortantes", () => {
  const rules = [
    { fromStatus: "TODO", toStatus: "IN_PROGRESS" },
    { fromStatus: "TODO", toStatus: "NOT_APPLICABLE" },
    { fromStatus: "IN_PROGRESS", toStatus: "PENDING_VALIDATION" },
  ];

  it("ne rend que celles issues de l'état demandé", async () => {
    listTransitionRules.mockResolvedValue(ok(rules));

    const result = await outgoingTransitions("TODO");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.map((rule) => rule.toStatus)).toEqual(["IN_PROGRESS", "NOT_APPLICABLE"]);
  });

  it("rend une liste vide pour un état terminal", async () => {
    listTransitionRules.mockResolvedValue(ok(rules));
    const result = await outgoingTransitions("ARCHIVED");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
  });

  it("propage un échec de lecture", async () => {
    const failure = err(AppError.internal());
    listTransitionRules.mockResolvedValue(failure);
    await expect(outgoingTransitions("TODO")).resolves.toEqual(failure);
  });

  it("la matrice complète est rendue telle quelle", async () => {
    listTransitionRules.mockResolvedValue(ok(rules));
    await expect(getTransitionMatrix()).resolves.toEqual(ok(rules));
  });
});
