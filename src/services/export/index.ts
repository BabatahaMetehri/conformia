import "server-only";

/**
 * Surface publique de la couche export.
 *
 * ⚠️ Point d'entrée unique de la feature `reports` : elle n'importe aucun chemin
 * interne, et surtout jamais `src/data` (CLAUDE.md §3.1). Ce fichier orchestre —
 * il journalise l'export, appelle le producteur, puis clôt la ligne — de sorte
 * qu'aucun appelant ne puisse produire un fichier SANS laisser de trace.
 */

import type { Json } from "@/types/database.types";
import { err, ok, type Result } from "@/lib/result";
import {
  finishExportRun,
  listExportRuns,
  logExport,
  startExportRun,
  type ExportKind,
  type ExportRunView,
  type ExportScopeFilters,
} from "@/data/queries/export";
import { buildComplianceReport, type ReportContext } from "./report";
import {
  buildTabularExport,
  type TabularFormat,
  type TabularKind,
  type TabularLabels,
} from "./tabular";
import { ASYNC_THRESHOLD, describeScope, planPeriodicExport } from "./periodic";

export type { ExportRunView, ExportScopeFilters, ExportKind };
export type { TabularKind, TabularFormat, TabularLabels };
export type { ReportContext };
export { ASYNC_THRESHOLD, describeScope };

const MIME: Readonly<Record<string, string>> = {
  XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  CSV: "text/csv; charset=utf-8",
  PDF: "application/pdf",
  ZIP: "application/zip",
};

export interface ProducedFile {
  readonly fileName: string;
  readonly contentBase64: string;
  readonly mimeType: string;
  readonly rowCount: number;
  readonly occurrenceCount: number;
}

function scopeJson(filters: ExportScopeFilters): Record<string, Json> {
  return {
    from: filters.from ?? null,
    to: filters.to ?? null,
    domainId: filters.domainId ?? null,
    authorityId: filters.authorityId ?? null,
  };
}

/**
 * Produit un tableau, en le journalisant.
 *
 * ⚠️ La ligne de journal est ouverte AVANT la production et close APRÈS, y
 * compris en cas d'échec. Un export raté qui ne laisserait aucune trace rendrait
 * incompréhensible la question « pourquoi ce fichier n'est jamais arrivé ».
 */
export async function produceTabular(
  kind: TabularKind,
  format: TabularFormat,
  filters: ExportScopeFilters,
  labels: TabularLabels,
): Promise<Result<ProducedFile>> {
  const run = await startExportRun({ kind, format, scope: scopeJson(filters) });
  if (!run.ok) return err(run.error);

  const produced = await buildTabularExport(kind, format, filters, labels);

  if (!produced.ok) {
    await finishExportRun({
      runId: run.value,
      status: "FAILED",
      occurrences: 0,
      documents: 0,
      sizeBytes: 0,
      fileName: "",
      error: produced.error.code,
    });
    return err(produced.error);
  }

  const bytes = Buffer.from(produced.value.contentBase64, "base64").byteLength;

  await finishExportRun({
    runId: run.value,
    status: "SUCCEEDED",
    occurrences: produced.value.occurrenceCount,
    documents: 0,
    sizeBytes: bytes,
    fileName: produced.value.fileName,
  });
  await logExport(kind, "obligation_occurrences", null, {
    rows: produced.value.rowCount,
    occurrences: produced.value.occurrenceCount,
    format,
  });

  return ok({
    fileName: produced.value.fileName,
    contentBase64: produced.value.contentBase64,
    mimeType: MIME[format] ?? "application/octet-stream",
    rowCount: produced.value.rowCount,
    occurrenceCount: produced.value.occurrenceCount,
  });
}

/** Produit le rapport PDF, en le journalisant. */
export async function produceReport(
  filters: ExportScopeFilters,
  context: ReportContext,
): Promise<Result<ProducedFile>> {
  const run = await startExportRun({ kind: "REPORT", format: "PDF", scope: scopeJson(filters) });
  if (!run.ok) return err(run.error);

  const produced = await buildComplianceReport(filters, context);

  if (!produced.ok) {
    await finishExportRun({
      runId: run.value,
      status: "FAILED",
      occurrences: 0,
      documents: 0,
      sizeBytes: 0,
      fileName: "",
      error: produced.error.code,
    });
    return err(produced.error);
  }

  const bytes = Buffer.from(produced.value.contentBase64, "base64").byteLength;

  await finishExportRun({
    runId: run.value,
    status: "SUCCEEDED",
    occurrences: produced.value.occurrenceCount,
    documents: 0,
    sizeBytes: bytes,
    fileName: produced.value.fileName,
  });
  // L'empreinte est journalisée : elle identifie la version des données sur
  // laquelle une décision a pu être prise.
  await logExport("REPORT", "obligation_occurrences", null, {
    occurrences: produced.value.occurrenceCount,
    fingerprint: produced.value.fingerprint,
  });

  return ok({
    fileName: produced.value.fileName,
    contentBase64: produced.value.contentBase64,
    mimeType: MIME["PDF"] ?? "application/pdf",
    rowCount: produced.value.occurrenceCount,
    occurrenceCount: produced.value.occurrenceCount,
  });
}

export { planPeriodicExport };

export function loadExportHistory(limit = 30): Promise<Result<readonly ExportRunView[]>> {
  return listExportRuns(limit);
}
