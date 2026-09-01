import { deflateRawSync } from "node:zlib";

/**
 * Écriture XLSX minimale, sans dépendance externe.
 *
 * ⚠️ POURQUOI PAS UNE BIBLIOTHÈQUE. CLAUDE.md §7 interdit d'ajouter une
 * dépendance hors de la pile du §2 sans validation. Le besoin, lui, est étroit :
 * une feuille, des chaînes, des nombres et des dates, sans formule, sans style
 * conditionnel, sans image. Les bibliothèques du domaine pèsent quelques
 * centaines de kilo-octets et couvrent cent fois ce périmètre.
 *
 * Un `.xlsx` est une archive ZIP contenant six fichiers XML. On l'écrit donc
 * directement, entrées compressées en DEFLATE par `node:zlib` — un module
 * INTÉGRÉ à Node, donc aucune dépendance ajoutée.
 *
 * ⚠️ Les entrées STOCKÉES (méthode 0) ont d'abord été retenues, pour se passer
 * même du compresseur. Mesure faite : le fichier produit était structurellement
 * valide — .NET le lisait — mais bsdtar, présent sur toutes les plateformes,
 * refusait l'archive entière. Un export qu'une partie de l'outillage rejette
 * n'est pas un export. DEFLATE règle la compatibilité ET divise la taille par
 * dix sur un tableau de plusieurs milliers de lignes.
 *
 * Aucun accès disque, aucun état : la fonction rend un `Uint8Array`.
 */

// ─── Modèle ──────────────────────────────────────────────────────────────────

export type CellValue = string | number | boolean | Date | null | undefined;

export interface SheetColumn {
  readonly header: string;
  /** Largeur en caractères. Sans elle, Excel colle tout à la largeur par défaut. */
  readonly width?: number;
}

export interface Sheet {
  /** 31 caractères maximum, sans `: \ / ? * [ ]` — limite d'Excel, pas la nôtre. */
  readonly name: string;
  readonly columns: readonly SheetColumn[];
  readonly rows: readonly (readonly CellValue[])[];
}

// ─── Échappement XML ─────────────────────────────────────────────────────────

/**
 * Un libellé d'obligation peut contenir `&` ou `<`. Non échappés, ils rendent le
 * classeur illisible — Excel refuse d'ouvrir un XML mal formé, sans dire pourquoi.
 */
function escapeXml(value: string): string {
  return (
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")
      // Les caractères de contrôle sont interdits en XML 1.0 et se glissent dans
      // des données recopiées depuis un PDF administratif.
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
  );
}

// ─── Références de cellule ───────────────────────────────────────────────────

/** 0 → A, 25 → Z, 26 → AA. */
export function columnName(index: number): string {
  let name = "";
  let remaining = index;
  while (remaining >= 0) {
    name = String.fromCharCode(65 + (remaining % 26)) + name;
    remaining = Math.floor(remaining / 26) - 1;
  }
  return name;
}

// ─── Dates ───────────────────────────────────────────────────────────────────

/**
 * Numéro de série Excel.
 *
 * L'époque est le 30/12/1899, et non le 01/01/1900 : Excel reproduit
 * délibérément un bug de Lotus 1-2-3 qui tient 1900 pour bissextile. Décaler de
 * deux jours est la correction admise, et la seule qui donne la bonne date pour
 * tout ce qui suit mars 1900.
 *
 * ⚠️ La valeur est calculée sur les composantes UTC. Les dates exportées doivent
 * donc déjà avoir été ramenées au calendrier d'Alger par l'appelant — un tableur
 * n'a pas de fuseau, il n'affichera que ce qu'on y écrit.
 */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

export function toExcelSerial(date: Date): number {
  return (date.getTime() - EXCEL_EPOCH_UTC) / MS_PER_DAY;
}

// ─── Feuille ─────────────────────────────────────────────────────────────────

/** Styles : 0 = normal, 1 = en-tête gras, 2 = date. */
const STYLE_HEADER = 1;
const STYLE_DATE = 2;

function cellXml(reference: string, value: CellValue): string {
  if (value === null || value === undefined || value === "") {
    return `<c r="${reference}"/>`;
  }
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? `<c r="${reference}"><v>${String(value)}</v></c>`
      : `<c r="${reference}"/>`;
  }
  if (typeof value === "boolean") {
    return `<c r="${reference}" t="b"><v>${value ? "1" : "0"}</v></c>`;
  }
  if (value instanceof Date) {
    return `<c r="${reference}" s="${String(STYLE_DATE)}"><v>${String(toExcelSerial(value))}</v></c>`;
  }
  // `inlineStr` évite la table de chaînes partagées : un fichier de plus à
  // écrire, un index de plus à tenir, pour un gain nul sur un export ponctuel.
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function sheetXml(sheet: Sheet): string {
  const columns = sheet.columns
    .map(
      (column, index) =>
        `<col min="${String(index + 1)}" max="${String(index + 1)}" width="${String(column.width ?? 18)}" customWidth="1"/>`,
    )
    .join("");

  const header = sheet.columns
    .map(
      (column, index) =>
        `<c r="${columnName(index)}1" t="inlineStr" s="${String(STYLE_HEADER)}"><is><t>${escapeXml(column.header)}</t></is></c>`,
    )
    .join("");

  const body = sheet.rows
    .map((row, rowIndex) => {
      const line = rowIndex + 2;
      const cells = row
        .map((value, index) => cellXml(`${columnName(index)}${String(line)}`, value))
        .join("");
      return `<row r="${String(line)}">${cells}</row>`;
    })
    .join("");

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<cols>${columns}</cols>` +
    `<sheetData><row r="1">${header}</row>${body}</sheetData>` +
    // Fige la ligne d'en-têtes et pose un filtre automatique : sur un export de
    // plusieurs milliers de lignes, les deux sont attendus.
    `<sheetViews/>` +
    `<autoFilter ref="A1:${columnName(Math.max(sheet.columns.length - 1, 0))}${String(sheet.rows.length + 1)}"/>` +
    `</worksheet>`
  );
}

/** 31 caractères et aucun des caractères qu'Excel réserve. */
function safeSheetName(name: string): string {
  const cleaned = name.replace(/[:\\/?*[\]]/g, " ").trim();
  return cleaned.length === 0 ? "Feuille1" : cleaned.slice(0, 31);
}

// ─── CRC32 ───────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ─── ZIP ─────────────────────────────────────────────────────────────────────

/*
 * Horodatage DOS fixe au 01/01/1980, la plus ancienne date representable.
 *
 * ⚠️ Zero n est PAS une valeur neutre : le format encode le jour sur les bits 0-4
 * et le mois sur 5-8, si bien que 0 signifie « jour 0 du mois 0 ». libarchive
 * refuse alors l archive entiere avec « this does not look like a tar archive »,
 * message qui n oriente vers rien.
 *
 * Une date FIXE plutot que l heure courante : deux exports du meme contenu
 * doivent produire deux fichiers identiques, sans quoi rien n est reproductible.
 */
const DOS_TIME = 0;
const DOS_DATE = 0x0021; // (0 << 9) | (1 << 5) | 1 → 01/01/1980

interface ZipEntry {
  readonly path: string;
  readonly data: Uint8Array;
}

function writeUint32(target: number[], value: number): void {
  target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function writeUint16(target: number[], value: number): void {
  target.push(value & 0xff, (value >>> 8) & 0xff);
}

/**
 * Archive ZIP à entrées STOCKÉES (méthode 0).
 *
 * Sans compression : la seule alternative sans dépendance serait d'implémenter
 * DEFLATE, ce qui est une bibliothèque à soi seul. Le format l'autorise
 * explicitement et tous les tableurs le lisent.
 */
function zip(entries: readonly ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();

  /*
   * ⚠️ On accumule des BLOCS, jamais un unique tableau de nombres étalé par
   * `push(...bytes)`. L'étalement passe chaque octet en ARGUMENT d'appel : une
   * feuille d'un mégaoctet produit un million d'arguments et fait déborder la
   * pile. Le défaut ne se voit qu'à partir de quelques milliers de lignes —
   * précisément le cas pour lequel l'export existe.
   */
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  let centralSize = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.path);
    const checksum = crc32(entry.data);
    const size = entry.data.length;
    // `deflateRaw` : le flux DEFLATE nu, sans en-tête zlib — c'est exactement ce
    // que le format ZIP attend pour la méthode 8.
    const compressed = new Uint8Array(deflateRawSync(entry.data));

    const localHeader: number[] = [];
    writeUint32(localHeader, 0x04034b50);
    writeUint16(localHeader, 20); // version minimale
    writeUint16(localHeader, 0x0800); // nom de fichier en UTF-8
    writeUint16(localHeader, 8); // méthode : DEFLATE
    writeUint16(localHeader, DOS_TIME);
    writeUint16(localHeader, DOS_DATE);
    writeUint32(localHeader, checksum);
    writeUint32(localHeader, compressed.length);
    writeUint32(localHeader, size);
    writeUint16(localHeader, nameBytes.length);
    writeUint16(localHeader, 0); // pas de champ supplémentaire

    chunks.push(Uint8Array.from(localHeader), nameBytes, compressed);

    const centralHeader: number[] = [];
    writeUint32(centralHeader, 0x02014b50);
    writeUint16(centralHeader, 20); // version d'écriture
    writeUint16(centralHeader, 20); // version minimale
    writeUint16(centralHeader, 0x0800);
    writeUint16(centralHeader, 8); // méthode : DEFLATE
    writeUint16(centralHeader, DOS_TIME);
    writeUint16(centralHeader, DOS_DATE);
    writeUint32(centralHeader, checksum);
    writeUint32(centralHeader, compressed.length);
    writeUint32(centralHeader, size);
    writeUint16(centralHeader, nameBytes.length);
    writeUint16(centralHeader, 0);
    writeUint16(centralHeader, 0); // commentaire
    writeUint16(centralHeader, 0); // disque
    writeUint16(centralHeader, 0); // attributs internes
    writeUint32(centralHeader, 0); // attributs externes
    writeUint32(centralHeader, offset);

    central.push(Uint8Array.from(centralHeader), nameBytes);
    centralSize += centralHeader.length + nameBytes.length;
    offset += localHeader.length + nameBytes.length + compressed.length;
  }

  const end: number[] = [];
  writeUint32(end, 0x06054b50);
  writeUint16(end, 0);
  writeUint16(end, 0);
  writeUint16(end, entries.length);
  writeUint16(end, entries.length);
  writeUint32(end, centralSize);
  writeUint32(end, offset);
  writeUint16(end, 0);

  return concat([...chunks, ...central, Uint8Array.from(end)]);
}

function concat(blocks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const block of blocks) total += block.length;

  const result = new Uint8Array(total);
  let position = 0;
  for (const block of blocks) {
    result.set(block, position);
    position += block.length;
  }
  return result;
}

// ─── Assemblage ──────────────────────────────────────────────────────────────

const CONTENT_TYPES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
  `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
  `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
  `</Types>`;

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
  `</Relationships>`;

const WORKBOOK_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
  `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
  `</Relationships>`;

/** Trois styles seulement : normal, en-tête gras, date au format `jj/mm/aaaa`. */
const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>` +
  `<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill>` +
  `<fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border/></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="3">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `</cellXfs>` +
  `</styleSheet>`;

function workbookXml(sheetName: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>` +
    `</workbook>`
  );
}

/** Classeur d'une feuille, prêt à être servi en téléchargement. */
export function buildXlsx(sheet: Sheet): Uint8Array {
  const encoder = new TextEncoder();
  const name = safeSheetName(sheet.name);

  return zip([
    { path: "[Content_Types].xml", data: encoder.encode(CONTENT_TYPES) },
    { path: "_rels/.rels", data: encoder.encode(ROOT_RELS) },
    { path: "xl/workbook.xml", data: encoder.encode(workbookXml(name)) },
    { path: "xl/_rels/workbook.xml.rels", data: encoder.encode(WORKBOOK_RELS) },
    { path: "xl/styles.xml", data: encoder.encode(STYLES) },
    { path: "xl/worksheets/sheet1.xml", data: encoder.encode(sheetXml(sheet)) },
  ]);
}
