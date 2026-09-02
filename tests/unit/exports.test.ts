// @vitest-environment node

import { describe, expect, it } from "vitest";

import { buildCsv, escapeCsv, CSV_DELIMITER, UTF8_BOM } from "@/lib/csv";
import { buildWorkbook, sanitizeSheetName } from "@/lib/workbook";
import { buildArchiveName, documentEntryName } from "@/services/export/dossier";
import { computeCompliance, computeLateReasons, computeWorkload } from "@/services/export/tabular";
import { fingerprintScope } from "@/services/export/report";
import type { ExportableOccurrence } from "@/data/queries/export";

/**
 * Les fonctions PURES de la couche export : mise en forme d'un CSV lisible par
 * Excel francophone, agrégations du rapport, nommage d'archive. Le reste — le
 * cloisonnement, le journal, l'alerte — se vérifie contre une vraie base.
 */

function occurrence(overrides: Partial<ExportableOccurrence> = {}): ExportableOccurrence {
  return {
    occurrenceId: "11111111-1111-1111-1111-111111111111",
    obligationCode: "G50",
    obligationName: "Déclaration mensuelle G50",
    domainCode: "FISCAL",
    authorityName: "DGI",
    periodKey: "2026-01",
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    legalDueDate: "2026-02-20",
    internalDueDate: "2026-02-13",
    status: "SUBMITTED",
    criticality: "CRITICAL",
    ownerName: "Nadia B.",
    validatorName: "Karim T.",
    submittedAt: "2026-02-18T09:00:00Z",
    lateReasonCode: null,
    lateReason: null,
    lateDays: 0,
    documentCount: 4,
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════════════════════

describe("CSV pour Excel francophone", () => {
  it("commence par la marque d'ordre des octets", () => {
    // Sans elle, Excel lit l'UTF-8 comme du Windows-1252 : « Déclaration »
    // devient « DÃ©claration ».
    const csv = buildCsv({ headers: ["Obligation"], rows: [["Déclaration"]] });
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    expect(csv).toContain("Déclaration");
  });

  it("sépare par POINT-VIRGULE", () => {
    // Sur un poste francophone, c'est la virgule qui sépare les décimales : un
    // CSV à virgules arrive entièrement dans la colonne A.
    const csv = buildCsv({ headers: ["a", "b"], rows: [["1", "2"]] });
    expect(csv).toContain(`a${CSV_DELIMITER}b`);
  });

  it("termine ses lignes en CRLF", () => {
    const csv = buildCsv({ headers: ["a"], rows: [["b"]] });
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(/[^\r]\n/.test(csv)).toBe(false);
  });

  it("NEUTRALISE UNE FORMULE", () => {
    /*
     * ⚠️ Excel interprète une cellule commençant par `=`, `+`, `-` ou `@` comme
     * une FORMULE. Un libellé d'obligation venu de la base suffirait à faire
     * exécuter du contenu à l'ouverture du fichier — c'est l'injection de
     * formule CSV, et elle se corrige à l'écriture.
     */
    for (const dangerous of ["=1+1", "+1", "-1", "@SUM(A1)"]) {
      expect(escapeCsv(dangerous).startsWith("'")).toBe(true);
    }
  });

  it("protège les guillemets et les séparateurs", () => {
    expect(escapeCsv('a"b')).toBe('"a""b"');
    expect(escapeCsv("a;b")).toBe('"a;b"');
    expect(escapeCsv("a\nb")).toBe('"a\nb"');
  });

  it("écrit une date en jj/mm/aaaa", () => {
    expect(escapeCsv(new Date("2026-02-20T12:00:00Z"))).toBe("20/02/2026");
  });

  it("écrit un nombre à virgule décimale", () => {
    // Cohérent avec le séparateur point-virgule : sinon le tableur découpe.
    expect(escapeCsv(1.5)).toBe("1,5");
  });

  it("rend une cellule VIDE pour null et undefined", () => {
    expect(escapeCsv(null)).toBe("");
    expect(escapeCsv(undefined)).toBe("");
  });
});

describe("classeur XLSX", () => {
  it("produit une archive ZIP valide", async () => {
    const bytes = await buildWorkbook([
      {
        name: "Suivi",
        columns: [
          { header: "Code", width: 12 },
          { header: "Échéance", format: "date" },
        ],
        rows: [["G50", new Date("2026-02-20T12:00:00Z")]],
      },
    ]);

    // Signature locale d'un ZIP : « PK\x03\x04 ». Un fichier qui ne la porte pas
    // n'est pas ouvrable par un tableur, quoi qu'il contienne.
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("accepte plusieurs feuilles", async () => {
    const bytes = await buildWorkbook([
      { name: "Une", columns: [{ header: "a" }], rows: [["x"]] },
      { name: "Deux", columns: [{ header: "b" }], rows: [["y"]] },
    ]);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it("tronque et nettoie un nom de feuille", () => {
    // 31 caractères, et six caractères interdits : la limite est celle d'Excel.
    expect(sanitizeSheetName("a".repeat(50))).toHaveLength(31);
    expect(sanitizeSheetName("Suivi/2026:janvier")).toBe("Suivi 2026 janvier");
    expect(sanitizeSheetName("   ")).toBe("Feuille");
  });
});

describe("nommage de l'archive de dossier", () => {
  it("suit le format demandé", () => {
    const name = buildArchiveName("G50", "2026-01", new Date("2026-09-02T14:30:00Z"));
    expect(name).toMatch(/^AGROESPACE_G50_2026-01_\d{8}-\d{4}\.zip$/);
  });

  it("neutralise ce qui n'a rien à faire dans un nom de fichier", () => {
    // Le code vient de la base : une barre oblique y créerait un sous-dossier,
    // et deux points casseraient le nom sous Windows.
    const name = buildArchiveName("A/B:C", "2026 Q1", new Date("2026-09-02T14:30:00Z"));
    expect(name).toContain("A-B-C");
    expect(name).not.toContain("/");
    expect(name).not.toContain(":");
  });

  it("préfixe chaque pièce par son rang de checklist", () => {
    // L'ordre alphabétique d'un explorateur reproduit alors l'ordre de la
    // checklist : le destinataire retrouve les pièces dans l'ordre attendu.
    const document = {
      normalizedFilename: "declaration.pdf",
      checklistOrder: 2,
    } as Parameters<typeof documentEntryName>[0];
    expect(documentEntryName(document, 9)).toBe("03_declaration.pdf");
  });

  it("retombe sur l'ordre d'arrivée quand la pièce n'est rattachée à rien", () => {
    const document = {
      normalizedFilename: "annexe.pdf",
      checklistOrder: null,
    } as Parameters<typeof documentEntryName>[0];
    expect(documentEntryName(document, 4)).toBe("05_annexe.pdf");
  });
});

describe("tableau de conformité", () => {
  it("CALCULE LE TAUX SUR LES DOSSIERS DÉPOSÉS, pas sur tous", () => {
    /*
     * ⚠️ Un exercice en cours contient des dossiers dont l'échéance n'est pas
     * venue. Les compter comme non conformes ferait chuter le taux pour la seule
     * raison que le temps n'a pas passé.
     */
    const lines = computeCompliance([
      occurrence({ occurrenceId: "a", lateDays: 0 }),
      occurrence({ occurrenceId: "b", lateDays: 3 }),
      occurrence({ occurrenceId: "c", submittedAt: null, lateDays: null, status: "TODO" }),
    ]);

    expect(lines).toHaveLength(1);
    expect(lines[0]?.total).toBe(3);
    expect(lines[0]?.submitted).toBe(2);
    expect(lines[0]?.pending).toBe(1);
    expect(lines[0]?.rate).toBe(0.5);
  });

  it("rend un taux NUL, pas zéro, quand rien n'est encore déposé", () => {
    // Zéro se lirait « aucune conformité » ; null se lit « rien à mesurer ».
    const lines = computeCompliance([
      occurrence({ submittedAt: null, lateDays: null, status: "TODO" }),
    ]);
    expect(lines[0]?.rate).toBeNull();
  });

  it("sépare les obligations et les trie par code", () => {
    const lines = computeCompliance([
      occurrence({ obligationCode: "TVA" }),
      occurrence({ obligationCode: "CNAS" }),
    ]);
    expect(lines.map((line) => line.code)).toEqual(["CNAS", "TVA"]);
  });
});

describe("charge par personne", () => {
  const today = "2026-03-01";

  it("compte les dossiers ouverts et ceux en retard", () => {
    const lines = computeWorkload(
      [
        occurrence({ status: "TODO", internalDueDate: "2026-02-01", submittedAt: null }),
        occurrence({ status: "IN_PROGRESS", internalDueDate: "2026-04-01", submittedAt: null }),
        occurrence({ status: "SUBMITTED" }),
      ],
      "Non affecté",
      today,
    );

    expect(lines[0]?.total).toBe(3);
    expect(lines[0]?.open).toBe(2);
    expect(lines[0]?.overdue).toBe(1);
    expect(lines[0]?.submitted).toBe(1);
  });

  it("FAIT APPARAÎTRE LES DOSSIERS SANS PORTEUR", () => {
    /*
     * ⚠️ Les écarter ferait disparaître du tableau exactement les dossiers dont
     * personne ne s'occupe — ceux qu'il faut voir en premier.
     */
    const lines = computeWorkload([occurrence({ ownerName: null })], "Non affecté", today);
    expect(lines[0]?.person).toBe("Non affecté");
  });

  it("classe la charge ouverte en tête", () => {
    const lines = computeWorkload(
      [
        occurrence({ ownerName: "Peu", status: "SUBMITTED" }),
        occurrence({ ownerName: "Beaucoup", status: "TODO", submittedAt: null }),
      ],
      "Non affecté",
      today,
    );
    expect(lines[0]?.person).toBe("Beaucoup");
  });
});

describe("motifs de retard", () => {
  it("ne retient que les dossiers réellement en retard", () => {
    const { lines, lateTotal } = computeLateReasons([
      occurrence({ lateDays: 0 }),
      occurrence({ lateDays: 5, lateReasonCode: "OVERSIGHT" }),
    ]);
    expect(lateTotal).toBe(1);
    expect(lines[0]?.code).toBe("OVERSIGHT");
  });

  it("FAIT DU MOTIF ABSENT UNE CATÉGORIE", () => {
    // « Non renseigné » est un résultat d'analyse, et souvent le plus gros bloc.
    const { lines } = computeLateReasons([occurrence({ lateDays: 2, lateReasonCode: null })]);
    expect(lines[0]?.code).toBe("UNSPECIFIED");
  });

  it("calcule part et retard moyen", () => {
    const { lines } = computeLateReasons([
      occurrence({ occurrenceId: "a", lateDays: 4, lateReasonCode: "OVERSIGHT" }),
      occurrence({ occurrenceId: "b", lateDays: 6, lateReasonCode: "OVERSIGHT" }),
      occurrence({ occurrenceId: "c", lateDays: 2, lateReasonCode: "MISSING_DOCUMENT" }),
    ]);

    expect(lines[0]?.count).toBe(2);
    expect(lines[0]?.share).toBeCloseTo(2 / 3);
    expect(lines[0]?.averageDays).toBe(5);
  });
});

describe("empreinte du rapport", () => {
  const rows = [
    {
      occurrenceId: "b",
      status: "SUBMITTED",
      legalDueDate: "2026-02-20",
      submittedAt: "2026-02-18",
    },
    { occurrenceId: "a", status: "TODO", legalDueDate: "2026-03-20", submittedAt: null },
  ];

  it("NE DÉPEND PAS DE L'ORDRE des lignes", () => {
    // L'ordre de la base ne doit pas changer l'empreinte : sinon deux rapports
    // du même périmètre en porteraient deux, et elle n'identifierait plus rien.
    expect(fingerprintScope(rows)).toBe(fingerprintScope([...rows].reverse()));
  });

  it("CHANGE quand une donnée change", () => {
    const modified = rows.map((row) =>
      row.occurrenceId === "b" ? { ...row, status: "ARCHIVED" } : row,
    );
    expect(fingerprintScope(modified)).not.toBe(fingerprintScope(rows));
  });

  it("rend une empreinte SHA-256", () => {
    expect(fingerprintScope(rows)).toMatch(/^[0-9a-f]{64}$/);
  });
});
