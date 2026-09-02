import "server-only";

import ExcelJS from "exceljs";

/**
 * Écriture de classeurs XLSX.
 *
 * ⚠️ CE MODULE REMPLACE `src/lib/xlsx.ts`, écrit à la main. Ce n'est pas un
 * revirement gratuit : le fichier précédent posait explicitement que la pile du
 * projet interdisait d'ajouter une bibliothèque sans validation, et que le
 * besoin — une feuille, des chaînes, des dates — ne la justifiait pas. Les deux
 * propositions étaient vraies, et ne le sont plus.
 *
 * Ce qui a changé : le prompt de cette phase désigne `exceljs` nommément — la
 * validation demandée est donc acquise — et le besoin a triplé. Les exports de
 * cette phase réclament plusieurs feuilles par classeur, un volet figé sur la
 * ligne d'en-tête, des formats de nombre distincts par colonne et des en-têtes
 * mis en forme. Écrire cela à la main aurait signifié réimplémenter la moitié
 * d'exceljs, sans ses tests.
 *
 * ⚠️ DEUX ÉCRITURES XLSX AURAIENT ÉTÉ PIRE QUE L'UNE OU L'AUTRE. L'ancien module
 * est supprimé et son unique appelant migré ici : deux générateurs de tableur
 * divergent au premier correctif, et c'est toujours celui qu'on a oublié qui
 * produit le fichier qu'un contrôleur reçoit.
 */

// ─── Modèle ──────────────────────────────────────────────────────────────────

export type CellValue = string | number | boolean | Date | null | undefined;

export type ColumnFormat = "text" | "date" | "integer" | "decimal" | "percent";

export interface SheetColumn {
  readonly header: string;
  /** Largeur en caractères. Sans elle, Excel colle tout à la largeur par défaut. */
  readonly width?: number;
  readonly format?: ColumnFormat;
}

export interface Sheet {
  /** 31 caractères maximum, sans `: \ / ? * [ ]` — limite d'Excel, pas la nôtre. */
  readonly name: string;
  readonly columns: readonly SheetColumn[];
  readonly rows: readonly (readonly CellValue[])[];
}

/**
 * Formats de nombre, en syntaxe Excel.
 *
 * ⚠️ `dd/mm/yyyy` et non `mm/dd/yyyy`. Une date administrative algérienne lue à
 * l'américaine transforme le 3 avril en 4 mars — silencieusement, et seulement
 * pour les douze premiers jours du mois, ce qui est la pire fréquence possible
 * pour un défaut : assez rare pour passer les tests, assez courant pour arriver.
 */
const NUMBER_FORMATS: Readonly<Record<ColumnFormat, string | undefined>> = {
  text: undefined,
  date: "dd/mm/yyyy",
  integer: "0",
  decimal: "0.00",
  percent: "0.0%",
};

/** 31 caractères, sans les six que le format interdit. */
export function sanitizeSheetName(name: string): string {
  const cleaned = name.replaceAll(/[:\\/?*[\]]/g, " ").trim();
  return cleaned.length === 0 ? "Feuille" : cleaned.slice(0, 31);
}

function applyHeader(worksheet: ExcelJS.Worksheet, columns: readonly SheetColumn[]): void {
  const header = worksheet.getRow(1);
  header.values = columns.map((column) => column.header);
  header.font = { bold: true };
  header.alignment = { vertical: "middle" };

  /*
   * ⚠️ VOLET FIGÉ sur la ligne d'en-tête. Sur un export de plusieurs milliers
   * d'occurrences — l'usage même de cette fonction — un tableau dont l'en-tête
   * disparaît au premier défilement oblige à remonter pour savoir ce qu'on lit.
   */
  worksheet.views = [{ state: "frozen", ySplit: 1 }];

  // Filtre automatique sur toute la plage : c'est le geste que fait n'importe
  // qui devant un tableau, et l'ajouter à la main est fastidieux.
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: Math.max(columns.length, 1) },
  };
}

function applyColumns(worksheet: ExcelJS.Worksheet, columns: readonly SheetColumn[]): void {
  columns.forEach((column, index) => {
    const target = worksheet.getColumn(index + 1);
    if (column.width !== undefined) target.width = column.width;

    const format = NUMBER_FORMATS[column.format ?? "text"];
    if (format !== undefined) target.numFmt = format;
  });
}

function toCell(value: CellValue): ExcelJS.CellValue {
  // `undefined` et `null` deviennent une cellule VIDE, pas la chaîne « null ».
  if (value === null || value === undefined) return null;
  return value;
}

function fillSheet(workbook: ExcelJS.Workbook, sheet: Sheet): void {
  const worksheet = workbook.addWorksheet(sanitizeSheetName(sheet.name));

  applyHeader(worksheet, sheet.columns);

  for (const row of sheet.rows) {
    worksheet.addRow(row.map(toCell));
  }

  // Après les lignes : ExcelJS applique les largeurs à la colonne, pas aux
  // cellules déjà écrites, mais le format de nombre doit exister avant lecture.
  applyColumns(worksheet, sheet.columns);
}

/**
 * Rend un classeur complet en mémoire.
 *
 * Convient aux exports tabulaires, bornés par `EXPORT_ROW_LIMIT`. L'archive de
 * dossier, elle, se construit en flux — voir `services/export/dossier.ts`.
 */
export async function buildWorkbook(sheets: readonly Sheet[]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CONFORMIA";
  workbook.created = new Date();

  for (const sheet of sheets) fillSheet(workbook, sheet);

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

/** Raccourci pour le cas courant : une seule feuille. */
export function buildSheetWorkbook(sheet: Sheet): Promise<Uint8Array> {
  return buildWorkbook([sheet]);
}
