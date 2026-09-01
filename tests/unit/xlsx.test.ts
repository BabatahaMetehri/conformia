import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { buildXlsx, columnName, toExcelSerial } from "@/lib/xlsx";

/**
 * Écriture XLSX.
 *
 * ⚠️ Le test qui compte n'est pas celui des octets : c'est celui qui DÉZIPPE le
 * fichier produit avec un outil externe. Un classeur qu'aucun logiciel ne sait
 * ouvrir n'est pas un export, c'est un fichier. `tar` sait lire un ZIP et est
 * présent nativement sur Windows, macOS et Linux — la vérification tourne donc
 * partout où tourne la suite.
 */

const workdir = mkdtempSync(join(tmpdir(), "conformia-xlsx-"));

afterAll(() => {
  rmSync(workdir, { recursive: true, force: true });
});

/**
 * Lecteur ZIP externe, résolu une fois.
 *
 * ⚠️ `tar` tout court ne suffit PAS. Sous Git Bash, `tar` est GNU tar, qui ne
 * connaît pas le format ZIP et répond « this does not look like a tar archive » —
 * message qui accuse le fichier alors que l'outil est en cause. Seul bsdtar
 * (libarchive), livré avec Windows et macOS, sait le lire ; `unzip` aussi.
 *
 * On ne se rabat JAMAIS silencieusement sur « pas de lecteur, test ignoré » :
 * une suite qui s'ignore elle-même affiche du vert sans rien vérifier.
 */
function resolveZipReader(): { readonly command: string; readonly args: readonly string[] } {
  const candidates: { command: string; args: string[] }[] = [
    ...(process.platform === "win32"
      ? [{ command: "C:\\Windows\\System32\\tar.exe", args: ["-xf"] }]
      : []),
    { command: "bsdtar", args: ["-xf"] },
    { command: "unzip", args: ["-o"] },
  ];

  for (const candidate of candidates) {
    try {
      execFileSync(candidate.command, ["--version"], { stdio: "pipe" });
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error(
    "Aucun lecteur ZIP disponible (bsdtar ou unzip). GNU tar ne convient pas : " +
      "il ne lit pas le format ZIP.",
  );
}

const reader = resolveZipReader();

function unzip(bytes: Uint8Array, label: string): string {
  const target = join(workdir, label);
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "classeur.xlsx"), bytes);

  // Exécuté DANS le dossier cible, avec un chemin relatif : un chemin Windows
  // absolu ferait interpréter « C: » comme un hôte distant.
  execFileSync(reader.command, [...reader.args, "classeur.xlsx"], {
    cwd: target,
    stdio: "pipe",
  });
  return target;
}

describe("columnName", () => {
  it("suit la numérotation d'un tableur", () => {
    expect(columnName(0)).toBe("A");
    expect(columnName(25)).toBe("Z");
    expect(columnName(26)).toBe("AA");
    expect(columnName(27)).toBe("AB");
    expect(columnName(51)).toBe("AZ");
    expect(columnName(52)).toBe("BA");
  });
});

describe("toExcelSerial", () => {
  it("donne le bon numéro de série pour les dates modernes", () => {
    // Valeurs de référence d'un tableur : le 01/01/2026 vaut 46023.
    expect(toExcelSerial(new Date(Date.UTC(2026, 0, 1)))).toBe(46023);
    expect(toExcelSerial(new Date(Date.UTC(2026, 1, 20)))).toBe(46073);
    // 01/03/1900, première date où l'époque 30/12/1899 devient exacte.
    expect(toExcelSerial(new Date(Date.UTC(1900, 2, 1)))).toBe(61);
  });

  it("un jour d'écart vaut exactement une unité", () => {
    const day = new Date(Date.UTC(2026, 5, 15));
    const next = new Date(Date.UTC(2026, 5, 16));
    expect(toExcelSerial(next) - toExcelSerial(day)).toBe(1);
  });
});

describe("buildXlsx", () => {
  const sheet = {
    name: "Échéancier",
    columns: [
      { header: "Obligation", width: 30 },
      { header: "Échéance", width: 14 },
      { header: "Pièces", width: 10 },
      { header: "En retard", width: 10 },
    ],
    rows: [
      ["G50 & TVA <mensuelle>", new Date(Date.UTC(2026, 1, 20)), 3, true],
      ["CNAS", new Date(Date.UTC(2026, 3, 30)), 0, false],
      [null, null, null, null],
    ],
  };

  it("produit une archive ZIP lisible par un outil externe", () => {
    const target = unzip(buildXlsx(sheet), "valide");

    // Les six parties d'un classeur minimal doivent être présentes et non vides.
    for (const part of [
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
    ]) {
      const content = readFileSync(join(target, part), "utf8");
      expect(content.length, part).toBeGreaterThan(0);
      expect(content.startsWith("<?xml"), part).toBe(true);
    }
  });

  it("échappe le XML plutôt que de produire un fichier illisible", () => {
    const target = unzip(buildXlsx(sheet), "echappement");
    const worksheet = readFileSync(join(target, "xl/worksheets/sheet1.xml"), "utf8");

    // Un `&` ou un `<` non échappé rend le classeur inouvrable, sans message utile.
    expect(worksheet).toContain("G50 &amp; TVA &lt;mensuelle&gt;");
    expect(worksheet).not.toContain("G50 & TVA");
  });

  it("écrit chaque type dans sa forme propre", () => {
    const target = unzip(buildXlsx(sheet), "types");
    const worksheet = readFileSync(join(target, "xl/worksheets/sheet1.xml"), "utf8");

    expect(worksheet).toContain('t="inlineStr"'); // texte
    expect(worksheet).toContain('t="b"'); // booléen
    expect(worksheet).toContain("<v>3</v>"); // nombre
    expect(worksheet).toContain('s="2"'); // date, style au format jj/mm/aaaa
    expect(worksheet).toContain('<c r="A4"/>'); // cellule vide
  });

  it("nomme la feuille dans les limites d'Excel", () => {
    const bytes = buildXlsx({
      ...sheet,
      name: "Un nom beaucoup trop long : avec/des\\caractères?interdits*",
    });
    const target = unzip(bytes, "nom");
    const workbook = readFileSync(join(target, "xl/workbook.xml"), "utf8");

    const match = /name="([^"]*)"/.exec(workbook);
    expect(match?.[1]?.length ?? 99).toBeLessThanOrEqual(31);
    expect(match?.[1]).not.toMatch(/[:\\/?*[\]]/);
  });

  it("supporte un export volumineux sans se dégrader", () => {
    const rows = Array.from({ length: 5000 }, (_, index) => [
      `Obligation ${String(index)}`,
      new Date(Date.UTC(2026, index % 12, 1 + (index % 28))),
      index % 5,
      index % 2 === 0,
    ]);

    const bytes = buildXlsx({ ...sheet, rows });
    expect(bytes.length).toBeGreaterThan(0);

    const target = unzip(bytes, "volume");
    const worksheet = readFileSync(join(target, "xl/worksheets/sheet1.xml"), "utf8");
    // 5000 lignes plus l'en-tête.
    expect(worksheet).toContain('<row r="5001">');
    expect(worksheet).not.toContain('<row r="5002">');
  });
});
