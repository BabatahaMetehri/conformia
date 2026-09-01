import { describe, expect, it } from "vitest";

import {
  buildNormalizedStem,
  extensionOf,
  inspectHeader,
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

describe("inspectHeader", () => {
  it("accepte un PDF cohérent", () => {
    expect(inspectHeader("bordereau.pdf", "application/pdf", PDF).rejection).toBeNull();
  });

  it("REFUSE un exécutable renommé en PDF", () => {
    // Le cas qui justifie tout le contrôle : le navigateur annonce un PDF,
    // l'extension dit PDF, et les octets disent « programme Windows ».
    const executable = bytes(0x4d, 0x5a, 0x90, 0x00);
    expect(inspectHeader("facture.pdf", "application/pdf", executable).rejection).toBe(
      "SIGNATURE_MISMATCH",
    );
  });

  it("REFUSE un SVG, quel que soit le type annoncé", () => {
    // Un SVG est un document XML exécutable servi depuis notre domaine.
    expect(inspectHeader("logo.svg", "text/xml", TEXT).rejection).toBe("EXTENSION_BLOCKED");
  });

  it("REFUSE un type MIME hors liste blanche", () => {
    expect(inspectHeader("script.bin", "application/octet-stream", PDF).rejection).toBe(
      "MIME_NOT_ALLOWED",
    );
  });

  it("accepte un CSV, qui n'a AUCUNE signature", () => {
    // Refuser l'absence de signature bloquerait tout format textuel.
    expect(inspectHeader("export.csv", "text/csv", TEXT).rejection).toBeNull();
  });

  it("refuse un binaire annoncé comme texte", () => {
    // L'inverse n'est pas symétrique : un ZIP annoncé en CSV a une signature,
    // et elle ne correspond pas.
    expect(inspectHeader("liste.csv", "text/csv", ZIP).rejection).toBe("SIGNATURE_MISMATCH");
  });

  it("refuse un fichier vide et un fichier trop volumineux", () => {
    expect(inspectHeader("vide.pdf", "application/pdf", bytes()).rejection).toBe("EMPTY_FILE");
  });

  it("traite .xlsx et .docx comme le conteneur ZIP qu'ils sont", () => {
    const xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    expect(inspectHeader("etat.xlsx", xlsx, ZIP).rejection).toBeNull();
    expect(inspectHeader("etat.xlsx", xlsx, ZIP).detectedMimeFamily).toBe("zip");
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

describe("racine du nom normalisé", () => {
  /**
   * ⚠️ Le nom COMPLET ne se compose plus ici : depuis 0009, le numéro de version
   * est réservé par `create_document_upload_ticket` au moment où elle émet le
   * billet — c'est ce qui empêche deux envois simultanés de revendiquer « v2 ».
   * Cette fonction ne produit donc que la racine ; la base y appose la version
   * et l'extension. Le chemin de stockage, lui, est entièrement composé en SQL,
   * et sa résistance au « ../ » est éprouvée dans la suite d'intégration.
   */
  it("intercale le libellé de la pièce", () => {
    expect(
      buildNormalizedStem({
        obligationCode: "G50",
        periodKey: "2026-01",
        documentKind: "JUSTIFICATIF",
        pieceLabel: "Bordereau signé",
      }),
    ).toBe("G50_2026-01_JUSTIFICATIF_bordereau-signe");
  });

  it("distingue DEUX pièces de même nature sur le même dossier", () => {
    // Sans le segment de libellé, ces deux racines seraient identiques et le
    // second dépôt violerait documents_version_key (occurrence, nom, version).
    const common = {
      obligationCode: "G50",
      periodKey: "2026-01",
      documentKind: "JUSTIFICATIF",
    } as const;

    expect(buildNormalizedStem({ ...common, pieceLabel: "Bordereau" })).not.toBe(
      buildNormalizedStem({ ...common, pieceLabel: "Annexe de calcul" }),
    );
  });

  it("retombe sur un libellé neutre quand la nature n'est pas renseignée", () => {
    expect(
      buildNormalizedStem({
        obligationCode: "G50",
        periodKey: "2026",
        documentKind: null,
        pieceLabel: "…",
      }),
    ).toBe("G50_2026_PIECE_piece");
  });

  it("ne produit QUE des caractères admis par la contrainte de forme SQL", () => {
    // `create_document_upload_ticket` refuse toute racine hors ^[A-Za-z0-9_-]+$.
    const stem = buildNormalizedStem({
      obligationCode: "G/50 «spécial»",
      periodKey: "2026-01",
      documentKind: null,
      pieceLabel: "Pièce n°1 — annexe/2",
    });
    expect(stem).toMatch(/^[A-Za-z0-9_-]{1,180}$/);
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
