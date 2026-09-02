/**
 * Écriture CSV pour Excel francophone.
 *
 * ⚠️ FONCTIONS PURES, sans dépendance : le format est trivial, ses pièges ne le
 * sont pas. Les trois qui suivent coûtent chacun un fichier illisible chez le
 * destinataire, et aucun ne se voit sur la machine qui l'a produit.
 */

/**
 * ⚠️ POINT-VIRGULE, pas virgule.
 *
 * Excel choisit son séparateur d'après le séparateur décimal du système : sur un
 * poste configuré en français, c'est la virgule qui sépare les décimales, donc
 * le point-virgule qui sépare les colonnes. Un CSV à virgules ouvert sur un tel
 * poste arrive entièrement dans la colonne A — et l'utilisateur conclut que
 * l'export est cassé.
 */
export const CSV_DELIMITER = ";";

/**
 * ⚠️ MARQUE D'ORDRE DES OCTETS en tête de fichier.
 *
 * Sans elle, Excel lit l'UTF-8 comme du Windows-1252 : « Déclaration » devient
 * « DÃ©claration ». Trois octets qui décident si un export de conformité est
 * présentable à un contrôleur.
 */
export const UTF8_BOM = "﻿";

const CRLF = "\r\n";

export type CsvValue = string | number | boolean | Date | null | undefined;

/**
 * Échappe une valeur.
 *
 * ⚠️ Le préfixe apostrophe sur les valeurs commençant par `=`, `+`, `-` ou `@`
 * n'est pas cosmétique : Excel interprète ces cellules comme des FORMULES. Une
 * obligation dont le libellé commencerait par un signe suffirait à faire
 * exécuter du contenu venu de la base à l'ouverture du fichier — c'est
 * l'injection de formule CSV, et elle se corrige à l'écriture, pas à la lecture.
 */
export function escapeCsv(value: CsvValue): string {
  if (value === null || value === undefined) return "";

  if (value instanceof Date) {
    // Date civile en jj/mm/aaaa : le tableur d'un poste francophone la reconnaît
    // comme une date, et non comme du texte.
    const day = String(value.getUTCDate()).padStart(2, "0");
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    return `${day}/${month}/${String(value.getUTCFullYear())}`;
  }

  if (typeof value === "number") {
    // Virgule décimale : cohérent avec le séparateur point-virgule ci-dessus.
    return Number.isFinite(value) ? String(value).replace(".", ",") : "";
  }

  if (typeof value === "boolean") return value ? "1" : "0";

  const text = /^[=+\-@]/.test(value) ? `'${value}` : value;

  const mustQuote =
    text.includes(CSV_DELIMITER) ||
    text.includes('"') ||
    text.includes("\n") ||
    text.includes("\r");

  return mustQuote ? `"${text.replaceAll('"', '""')}"` : text;
}

export interface CsvTable {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly CsvValue[])[];
}

/** Sérialise un tableau complet, BOM compris. */
export function buildCsv(table: CsvTable): string {
  const lines = [
    table.headers.map(escapeCsv).join(CSV_DELIMITER),
    ...table.rows.map((row) => row.map(escapeCsv).join(CSV_DELIMITER)),
  ];

  // Fins de ligne CRLF : la convention du format, et la seule que tous les
  // tableurs Windows lisent sans reformater le fichier à l'enregistrement.
  return UTF8_BOM + lines.join(CRLF) + CRLF;
}
