import "server-only";

/**
 * Export XLSX de la vue courante.
 *
 * ⚠️ L'export respecte les filtres APPLIQUÉS, sans exception. Il ne réinterroge
 * pas la base sans eux et n'élargit rien : ce qu'on télécharge est ce qu'on
 * voit. Un export plus large que la vue serait une fuite — les mêmes filtres
 * portent le cloisonnement par domaine que la RLS impose.
 */

import { formatDateFr } from "@/lib/dates";
import { err, ok, type Result } from "@/lib/result";
import { buildXlsx, type CellValue, type Sheet } from "@/lib/xlsx";
import { AppError } from "@/lib/errors";
import { exportRows, type OccurrenceFilters, type OccurrenceListRow } from "@/services/occurrences";
import { EXPORT_ROW_LIMIT } from "@/data/queries/occurrence-list";

export interface ExportResult {
  readonly filename: string;
  /** Encodé en base64 : une Server Action ne sait pas transporter d'octets bruts. */
  readonly contentBase64: string;
  readonly rowCount: number;
  /** Vrai si la borne d'export a été atteinte — l'écran doit le dire. */
  readonly truncated: boolean;
}

/** Libellés de colonnes, traduits par l'appelant : ce module n'a pas de catalogue. */
export interface ExportLabels {
  readonly sheetName: string;
  readonly obligation: string;
  readonly code: string;
  readonly period: string;
  readonly internalDue: string;
  readonly legalDue: string;
  readonly status: string;
  readonly owner: string;
  readonly validator: string;
  readonly documents: string;
  readonly overdue: string;
  readonly domain: string;
  readonly authority: string;
  readonly criticality: string;
  readonly yes: string;
  readonly no: string;
  readonly statusOf: (status: string) => string;
  readonly criticalityOf: (criticality: string) => string;
}

/**
 * Date civile pour un tableur.
 *
 * ⚠️ La colonne est un `date` PostgreSQL (`2026-02-20`), sans heure ni fuseau.
 * On la reconstruit à MIDI UTC : à minuit, une conversion de fuseau la ferait
 * basculer d'un jour, et le tableur afficherait la veille.
 */
function toSpreadsheetDate(iso: string): Date | null {
  if (iso.length === 0) return null;
  const date = new Date(`${iso}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toSheet(rows: readonly OccurrenceListRow[], labels: ExportLabels): Sheet {
  const columns = [
    { header: labels.code, width: 14 },
    { header: labels.obligation, width: 34 },
    { header: labels.period, width: 12 },
    // L'échéance INTERNE d'abord : c'est l'objectif, la légale n'est que la
    // limite. L'ordre des colonnes porte le même message que l'écran.
    { header: labels.internalDue, width: 14 },
    { header: labels.legalDue, width: 14 },
    { header: labels.status, width: 18 },
    { header: labels.owner, width: 24 },
    { header: labels.validator, width: 24 },
    { header: labels.documents, width: 12 },
    { header: labels.overdue, width: 12 },
    { header: labels.domain, width: 16 },
    { header: labels.authority, width: 22 },
    { header: labels.criticality, width: 14 },
  ];

  const body: CellValue[][] = rows.map((row) => [
    row.obligationCode,
    row.obligationName,
    row.periodKey,
    toSpreadsheetDate(row.internalDueDate),
    toSpreadsheetDate(row.legalDueDate),
    labels.statusOf(row.status),
    row.ownerName,
    row.validatorName,
    // Texte et non fraction : « 2/5 » se lit, 0,4 ne dit rien.
    `${String(row.documentsProvided)}/${String(row.documentsRequired)}`,
    row.isOverdue ? labels.yes : labels.no,
    row.domainLabel,
    row.authorityName,
    labels.criticalityOf(row.criticality),
  ]);

  return { name: labels.sheetName, columns, rows: body };
}

export async function exportOccurrencesXlsx(
  filters: OccurrenceFilters,
  labels: ExportLabels,
): Promise<Result<ExportResult>> {
  const rows = await exportRows(filters);
  if (!rows.ok) return rows;

  if (rows.value.length === 0) {
    return err(AppError.validationFailed({ reason: "EXPORT_EMPTY" }));
  }

  const bytes = buildXlsx(toSheet(rows.value, labels));

  // Horodatage dans le nom : deux exports successifs ne doivent pas s'écraser
  // dans le dossier de téléchargement.
  const stamp = formatDateFr(new Date()).replace(/\//g, "-");

  return ok({
    filename: `echeancier-${stamp}.xlsx`,
    contentBase64: Buffer.from(bytes).toString("base64"),
    rowCount: rows.value.length,
    truncated: rows.value.length >= EXPORT_ROW_LIMIT,
  });
}
