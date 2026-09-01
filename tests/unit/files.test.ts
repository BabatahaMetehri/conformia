import { describe, expect, it } from "vitest";

import {
  buildNormalizedFilename,
  buildStoragePath,
  extensionOf,
  inspectFile,
  sanitize,
  sha256Hex,
  slugify,
  sniffFamily,
} from "@/lib/files";

/**
 * Assainissement et contrôle des pièces déposées.
 *
 * Ces fonctions sont la première barrière entre un navigateur et le stockage.
 * Chaque cas ci-dessous correspond à une manière connue de faire entrer un
 * fichier qui n'aurait pas dû passer.
 */

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);
const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00);
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00);
const TEXT = new TextEncoder().encode("code;libelle\nG50;Déclaration");

const MAX = 25 * 1024 * 1024;

describe("détection de signature", () => {
  it("reconnaît les formats attendus par leurs premiers octets", () => {
    expect(sniffFamily(PDF)).toBe("pdf");
    expect(sniffFamily(PNG)).toBe("png");
    expect(sniffFamily(ZIP)).toBe("zip");
    expect(sniffFamily(bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1))).toBe("ole2");
  });

  it("ne prétend rien sur un contenu sans signature", () => {
    expect(sniffFamily(TEXT)).toBeNull();
  });

  it("ne déborde pas sur un fichier plus court que la signature", () => {
    expect(sniffFamily(bytes(0x25, 0x50))).toBeNull();
  });
});

describe("inspectFile", () => {
  it("accepte un PDF cohérent", () => {
    expect(inspectFile("bordereau.pdf", "application/pdf", PDF, MAX).rejection).toBeNull();
  });

  it("REFUSE un exécutable renommé en PDF", () => {
    // Le cas qui justifie tout le contrôle : le navigateur annonce un PDF,
    // l'extension dit PDF, et les octets disent « programme Windows ».
    const executable = bytes(0x4d, 0x5a, 0x90, 0x00);
    expect(inspectFile("facture.pdf", "application/pdf", executable, MAX).rejection).toBe(
      "SIGNATURE_MISMATCH",
    );
  });

  it("REFUSE un SVG, quel que soit le type annoncé", () => {
    // Un SVG est un document XML exécutable servi depuis notre domaine.
    expect(inspectFile("logo.svg", "text/xml", TEXT, MAX).rejection).toBe("EXTENSION_BLOCKED");
  });

  it("REFUSE un type MIME hors liste blanche", () => {
    expect(inspectFile("script.bin", "application/octet-stream", PDF, MAX).rejection).toBe(
      "MIME_NOT_ALLOWED",
    );
  });

  it("accepte un CSV, qui n'a AUCUNE signature", () => {
    // Refuser l'absence de signature bloquerait tout format textuel.
    expect(inspectFile("export.csv", "text/csv", TEXT, MAX).rejection).toBeNull();
  });

  it("refuse un binaire annoncé comme texte", () => {
    // L'inverse n'est pas symétrique : un ZIP annoncé en CSV a une signature,
    // et elle ne correspond pas.
    expect(inspectFile("liste.csv", "text/csv", ZIP, MAX).rejection).toBe("SIGNATURE_MISMATCH");
  });

  it("refuse un fichier vide et un fichier trop volumineux", () => {
    expect(inspectFile("vide.pdf", "application/pdf", bytes(), MAX).rejection).toBe("EMPTY_FILE");
    expect(inspectFile("gros.pdf", "application/pdf", PDF, 2).rejection).toBe("TOO_LARGE");
  });

  it("traite .xlsx et .docx comme le conteneur ZIP qu'ils sont", () => {
    const xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    expect(inspectFile("etat.xlsx", xlsx, ZIP, MAX).rejection).toBeNull();
    expect(inspectFile("etat.xlsx", xlsx, ZIP, MAX).detectedMimeFamily).toBe("zip");
  });
});

describe("assainissement", () => {
  it("supprime les diacritiques au lieu de les remplacer par des tirets", () => {
    expect(slugify("Déclaration mensuelle")).toBe("declaration-mensuelle");
    expect(slugify("État des créances")).toBe("etat-des-creances");
  });

  it("neutralise une traversée de répertoire", () => {
    // ⚠️ Le cas pour lequel cette fonction existe.
    expect(slugify("../../etc/passwd")).toBe("etc-passwd");
    expect(slugify("..\\..\\windows\\system32")).toBe("windows-system32");
  });

  it("neutralise les caractères de contrôle et l'octet nul", () => {
    expect(slugify("piece\u0000\u001f.pdf")).toBe("piece-pdf");
  });

  it("conserve la casse quand on le lui demande", () => {
    expect(sanitize("G50-2026")).toBe("G50-2026");
    expect(slugify("G50-2026")).toBe("g50-2026");
  });

  it("rend une chaîne vide plutôt qu'un tiret isolé", () => {
    expect(slugify("///")).toBe("");
    expect(slugify("«…»")).toBe("");
    // « é » se décompose en « e » : c'est le comportement voulu, pas un vide.
    expect(slugify("é")).toBe("e");
  });
});

describe("extensionOf", () => {
  it("rend l'extension en minuscules", () => {
    expect(extensionOf("Bordereau.PDF")).toBe("pdf");
  });

  it("ignore le chemin qui précède le nom", () => {
    expect(extensionOf("C:\\temp\\etat.xlsx")).toBe("xlsx");
    expect(extensionOf("/tmp/etat.xlsx")).toBe("xlsx");
  });

  it("rend une chaîne vide en l'absence d'extension exploitable", () => {
    expect(extensionOf("sans-extension")).toBe("");
    expect(extensionOf(".gitignore")).toBe("");
    expect(extensionOf("fin.")).toBe("");
  });
});

describe("chemin de stockage", () => {
  const parts = {
    entityCode: "AGROESPACE",
    domainCode: "FISCAL",
    obligationCode: "G50",
    periodKey: "2026-01",
    documentId: "11111111-2222-3333-4444-555555555555",
    originalFilename: "Bordereau signé.pdf",
  };

  it("suit la convention et passe chaque segment au slug", () => {
    expect(buildStoragePath(parts)).toBe(
      "agroespace/fiscal/g50/2026-01/11111111-2222-3333-4444-555555555555_bordereau-signe.pdf",
    );
  });

  it("ne laisse AUCUN segment de chemin venir du nom d'origine", () => {
    const hostile = buildStoragePath({ ...parts, originalFilename: "../../../secret.pdf" });
    expect(hostile.split("/")).toHaveLength(5);
    expect(hostile).not.toContain("..");
  });

  it("reste valide quand le nom d'origine n'a pas d'extension", () => {
    expect(buildStoragePath({ ...parts, originalFilename: "bordereau" })).toMatch(/_bordereau$/);
  });
});

describe("nom normalisé", () => {
  it("intercale le libellé de la pièce", () => {
    expect(
      buildNormalizedFilename({
        obligationCode: "G50",
        periodKey: "2026-01",
        documentKind: "JUSTIFICATIF",
        pieceLabel: "Bordereau signé",
        version: 2,
        extension: "pdf",
      }),
    ).toBe("G50_2026-01_JUSTIFICATIF_bordereau-signe_v2.pdf");
  });

  it("distingue DEUX pièces de même nature sur le même dossier", () => {
    // ⚠️ Sans le segment de libellé, ces deux noms seraient identiques et le
    // second dépôt violerait documents_version_key (occurrence, nom, version).
    const common = {
      obligationCode: "G50",
      periodKey: "2026-01",
      documentKind: "JUSTIFICATIF",
      version: 1,
      extension: "pdf",
    } as const;

    expect(buildNormalizedFilename({ ...common, pieceLabel: "Bordereau" })).not.toBe(
      buildNormalizedFilename({ ...common, pieceLabel: "Annexe de calcul" }),
    );
  });

  it("retombe sur un libellé neutre quand la nature n'est pas renseignée", () => {
    expect(
      buildNormalizedFilename({
        obligationCode: "G50",
        periodKey: "2026",
        documentKind: null,
        pieceLabel: "…",
        version: 1,
        extension: "",
      }),
    ).toBe("G50_2026_PIECE_piece_v1");
  });
});

describe("empreinte", () => {
  it("rend le SHA-256 attendu, en hexadécimal minuscule", async () => {
    // Vecteur de référence : SHA-256 de la chaîne vide.
    expect(await sha256Hex(new Uint8Array())).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("distingue deux contenus qui ne diffèrent que d'un octet", async () => {
    const left = await sha256Hex(new TextEncoder().encode("montant: 1000"));
    const right = await sha256Hex(new TextEncoder().encode("montant: 1001"));
    expect(left).not.toBe(right);
  });
});
