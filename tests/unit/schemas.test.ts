// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  checkPeriodCoherence,
  createOccurrenceSchema,
  hasControlCharacters,
  isRepetitive,
  isoDateSchema,
  parseInput,
  reasonSchema,
  significantLength,
  transitionSchema,
  uuidSchema,
  issuesOf,
  filenameSchema,
  uploadRequestSchema,
  MAX_DOCUMENT_BYTES,
} from "@/lib/schemas";
import { fieldIssues, translateIssue } from "@/lib/schemas/messages";

/**
 * Les règles métier de validation, éprouvées une par une.
 *
 * ⚠️ Chacune existe parce qu'une saisie plausible la viole. Ce ne sont pas des
 * garde-fous théoriques : une date de dépôt antérieure à la période, un motif
 * « aaaaaaaaaa », un fichier renommé — les trois arrivent, et les trois coûtent
 * cher à démêler après coup.
 */

const OK_UUID = "11111111-1111-1111-1111-111111111111";

// ═════════════════════════════════════════════════════════════════════════════

describe("caractères invisibles", () => {
  it("laisse passer tabulation et sauts de ligne", () => {
    // Un motif multiligne est légitime : on ne casse pas une saisie normale.
    expect(hasControlCharacters("ligne un\nligne deux\ttabulée")).toBe(false);
  });

  it("REFUSE un caractère de largeur nulle", () => {
    // Deux codes visuellement identiques et non égaux : le pire des défauts,
    // parce qu'il est littéralement invisible à la relecture.
    expect(hasControlCharacters(`G50${String.fromCharCode(0x200b)}`)).toBe(true);
  });

  it("REFUSE un contrôle C0 et une marque d'ordre des octets", () => {
    expect(hasControlCharacters(`a${String.fromCharCode(0x00)}b`)).toBe(true);
    expect(hasControlCharacters(`${String.fromCharCode(0xfeff)}texte`)).toBe(true);
  });

  it("REFUSE un séparateur de ligne Unicode", () => {
    expect(hasControlCharacters(`a${String.fromCharCode(0x2028)}b`)).toBe(true);
  });
});

describe("longueur significative", () => {
  it("replie les espaces multiples et coupe les extrémités", () => {
    expect(significantLength("  a   b  ")).toBe(3);
  });

  it("compte zéro pour une saisie d'espaces seuls", () => {
    expect(significantLength("        ")).toBe(0);
  });
});

describe("saisie de remplissage", () => {
  it("RECONNAÎT un caractère répété", () => {
    expect(isRepetitive("aaaaaaaaaa")).toBe(true);
    expect(isRepetitive("..........")).toBe(true);
  });

  it("RECONNAÎT un motif court répété", () => {
    expect(isRepetitive("abababababab")).toBe(true);
    expect(isRepetitive("azerty azerty azerty".replaceAll(" ", ""))).toBe(true);
  });

  it("RECONNAÎT une saisie sans aucune lettre", () => {
    expect(isRepetitive("1234567890")).toBe(true);
    expect(isRepetitive("---------- ")).toBe(true);
  });

  it("LAISSE PASSER une vraie explication", () => {
    // Le test qui protège du zèle : une règle trop stricte refuserait des motifs
    // légitimes, et l'utilisateur finirait par écrire n'importe quoi de long.
    for (const reason of [
      "Oubli du service comptabilité, relance envoyée le 12.",
      "Attente du bilan du cabinet, reçu avec dix jours de retard.",
      "Validateur en congé, aucune délégation n'était active.",
      "Pièce manquante : attestation CNAS non délivrée à temps.",
    ]) {
      expect(isRepetitive(reason), reason).toBe(false);
    }
  });
});

describe("motif obligatoire", () => {
  it("REFUSE des espaces seuls", () => {
    expect(reasonSchema.safeParse("            ").success).toBe(false);
  });

  it("REFUSE moins de dix caractères significatifs", () => {
    expect(reasonSchema.safeParse("trop court").success).toBe(true); // exactement 10
    expect(reasonSchema.safeParse("court").success).toBe(false);
    // Onze espaces entre deux mots ne font pas onze caractères.
    expect(reasonSchema.safeParse("a          b").success).toBe(false);
  });

  it("REFUSE une saisie de remplissage, même longue", () => {
    const parsed = reasonSchema.safeParse("aaaaaaaaaaaaaaaaaaaaaaa");
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe("validation.reasonNotMeaningful");
    }
  });

  it("ACCEPTE une explication ordinaire", () => {
    expect(reasonSchema.safeParse("Oubli du service, corrigé depuis.").success).toBe(true);
  });
});

describe("dates", () => {
  it("REFUSE une date qui n'existe pas", () => {
    /*
     * ⚠️ `new Date("2026-02-31")` ne lève pas : il rend le 3 mars. Sans la
     * comparaison aller-retour, l'utilisateur croirait sa saisie acceptée et
     * découvrirait une échéance décalée de trois jours.
     */
    expect(isoDateSchema.safeParse("2026-02-31").success).toBe(false);
    expect(isoDateSchema.safeParse("2026-13-01").success).toBe(false);
    expect(isoDateSchema.safeParse("2028-02-29").success).toBe(true); // bissextile
  });

  it("REFUSE un format non ISO", () => {
    expect(isoDateSchema.safeParse("20/02/2026").success).toBe(false);
    expect(isoDateSchema.safeParse("2026-2-1").success).toBe(false);
  });

  it("REFUSE une année hors plage plausible", () => {
    // Une faute de frappe, pas une législation : 1926 et 2226 sont des erreurs.
    expect(isoDateSchema.safeParse("1926-01-01").success).toBe(false);
    expect(isoDateSchema.safeParse("2226-01-01").success).toBe(false);
  });
});

describe("cohérence de période", () => {
  const collect = (dates: Parameters<typeof checkPeriodCoherence>[0]): string[] => {
    const keys: string[] = [];
    checkPeriodCoherence(dates, (_path, key) => keys.push(key));
    return keys;
  };

  it("accepte un jeu de dates cohérent", () => {
    expect(
      collect({
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        legalDueDate: "2026-02-20",
        internalDueDate: "2026-02-13",
      }),
    ).toEqual([]);
  });

  it("REFUSE une échéance légale ANTÉRIEURE à la fin de période", () => {
    // On ne dépose pas une déclaration avant que la période soit close.
    expect(
      collect({
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        legalDueDate: "2026-01-20",
        internalDueDate: "2026-01-15",
      }),
    ).toContain("validation.dueBeforePeriodEnd");
  });

  it("REFUSE une fin de période antérieure à son début", () => {
    expect(
      collect({
        periodStart: "2026-02-01",
        periodEnd: "2026-01-31",
        legalDueDate: "2026-03-20",
        internalDueDate: "2026-03-13",
      }),
    ).toContain("validation.periodEndBeforeStart");
  });

  it("REFUSE une échéance interne POSTÉRIEURE à la légale", () => {
    // L'interne est la marge : après la légale, elle alerterait après le retard.
    expect(
      collect({
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        legalDueDate: "2026-02-20",
        internalDueDate: "2026-02-25",
      }),
    ).toContain("validation.internalAfterLegal");
  });

  it("signale la cohérence SUR LE CHAMP FAUTIF, pas sur le formulaire", () => {
    const parsed = createOccurrenceSchema.safeParse({
      obligationTypeId: OK_UUID,
      periodKey: "2026-01",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      legalDueDate: "2026-01-20",
      internalDueDate: "2026-01-15",
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      // Le message doit se poser sous la date fautive : une erreur affichée en
      // tête de formulaire laisse chercher laquelle des quatre dates corriger.
      const issues = fieldIssues(parsed.error);
      expect(issues.map((issue) => issue.path)).toContain("legalDueDate");
    }
  });
});

describe("identifiants", () => {
  it("REFUSE ce qui n'est pas un UUID, avant toute requête", () => {
    expect(uuidSchema.safeParse("pas-un-uuid").success).toBe(false);
    expect(uuidSchema.safeParse("").success).toBe(false);
    expect(uuidSchema.safeParse(OK_UUID).success).toBe(true);
  });
});

describe("fichiers", () => {
  it("REFUSE un nom porteur de chemin", () => {
    expect(filenameSchema.safeParse("../../etc/passwd").success).toBe(false);
    expect(filenameSchema.safeParse("dossier/fichier.pdf").success).toBe(false);
    expect(filenameSchema.safeParse("bordereau.pdf").success).toBe(true);
  });

  it("REFUSE un fichier vide ou trop volumineux", () => {
    const base = {
      occurrenceId: OK_UUID,
      filename: "a.pdf",
      mimeType: "application/pdf",
    };
    expect(uploadRequestSchema.safeParse({ ...base, sizeBytes: 0 }).success).toBe(false);
    expect(
      uploadRequestSchema.safeParse({ ...base, sizeBytes: MAX_DOCUMENT_BYTES + 1 }).success,
    ).toBe(false);
    expect(uploadRequestSchema.safeParse({ ...base, sizeBytes: 1024 }).success).toBe(true);
  });
});

describe("verrouillage optimiste", () => {
  it("EXIGE une version attendue sur une transition", () => {
    /*
     * ⚠️ Sans version attendue, deux décisions concurrentes sur le même dossier
     * s'écrasent en silence — et l'historique montre un rejet sur un dossier
     * validé, incompréhensible six mois plus tard.
     */
    const parsed = transitionSchema.safeParse({
      occurrenceId: OK_UUID,
      toStatus: "VALIDATED",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(fieldIssues(parsed.error).map((issue) => issue.path)).toContain("expectedVersion");
    }
  });
});

describe("analyse d'entrée en Server Action", () => {
  it("rend une ERREUR STRUCTURÉE, jamais une exception", () => {
    const result = parseInput(transitionSchema, { occurrenceId: "x", toStatus: "NEANT" });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("VALIDATION_FAILED");

    const issues = issuesOf(result.error);
    expect(issues.length).toBeGreaterThan(0);
    // Chaque anomalie nomme SON champ et SA clé : c'est ce qui permet à
    // l'interface d'afficher le message sous le bon libellé.
    for (const issue of issues) {
      expect(issue.path.length).toBeGreaterThan(0);
      expect(issue.key.startsWith("validation.")).toBe(true);
    }
  });

  it("rend la valeur analysée en cas de succès", () => {
    const result = parseInput(transitionSchema, {
      occurrenceId: OK_UUID,
      toStatus: "IN_PROGRESS",
      expectedVersion: 3,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.expectedVersion).toBe(3);
  });

  it("ne laisse JAMAIS échapper le message brut de Zod", () => {
    // Le message de Zod est en anglais et technique : l'afficher ferait fuiter
    // l'outillage dans l'interface, sans rien dire d'utile à l'utilisateur.
    const result = parseInput(transitionSchema, { occurrenceId: 42 });
    expect(result.ok).toBe(false);
    if (result.ok) return;

    /*
     * On cible la PHRASE de Zod, pas le mot « expected » — qui apparaît
     * légitimement dans nos propres clés (`validation.numberExpected`). Le
     * premier jet de ce test confondait les deux.
     */
    const serialised = JSON.stringify(result.error.details);
    expect(serialised).not.toMatch(/invalid_type|Expected \w+, received/i);
    expect(serialised).not.toMatch(/String must contain|Required/);
  });
});

describe("traduction des anomalies", () => {
  const t = (key: string, values?: Record<string, string | number>): string =>
    values === undefined ? key : `${key}(${JSON.stringify(values)})`;

  it("emploie notre clé quand la primitive en pose une", () => {
    const parsed = reasonSchema.safeParse("court");
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      expect(issue).toBeDefined();
      if (issue !== undefined) {
        expect(translateIssue(issue, t)).toContain("validation.reasonTooShort");
      }
    }
  });

  it("retombe sur une clé générique pour une anomalie non couverte", () => {
    const parsed = transitionSchema.safeParse({ occurrenceId: OK_UUID, toStatus: "NEANT" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        expect(translateIssue(issue, t).startsWith("validation.")).toBe(true);
      }
    }
  });
});
