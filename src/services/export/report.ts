import "server-only";

/**
 * RAPPORT PDF DE CONFORMITÉ.
 *
 * ⚠️ Le choix de `@react-pdf/renderer` est justifié dans `pdf/theme.ts`, au plus
 * près des styles qu'il commande. En résumé : mise en page déclarative et
 * pagination automatique, contre un positionnement en coordonnées absolues
 * (pdfkit) ou un Chromium embarqué (puppeteer).
 *
 * ⚠️ LE RAPPORT PORTE UNE EMPREINTE de ses données d'entrée. Elle ne prouve pas
 * l'authenticité — n'importe qui peut recalculer un SHA-256 — mais elle IDENTIFIE
 * une version : deux tirages du même périmètre à deux semaines d'intervalle
 * portent des empreintes différentes, et l'on sait lequel a servi de base à une
 * décision. C'est le besoin réel ; une signature cryptographique en serait un
 * autre, qui suppose une autorité de certification que l'entreprise n'a pas.
 */

import { createHash } from "node:crypto";

import { renderToBuffer } from "@react-pdf/renderer";

import { formatDateFr, formatDateTimeFr } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { loadMyExportScope, type ExportScopeFilters } from "@/data/queries/export";
import { computeCompliance, computeLateReasons } from "./tabular";
import { ComplianceReport, type ReportData, type ReportLabels } from "./pdf/compliance-report";

/**
 * Nombre de retards détaillés dans le rapport.
 *
 * ⚠️ Un rapport qui liste six cents retards ligne à ligne n'est pas lu. Au-delà,
 * le compte des lignes omises est AFFICHÉ — l'exhaustivité vit dans l'export
 * tabulaire, dont c'est le métier, et le rapport le dit plutôt que de tronquer
 * en silence.
 */
export const MAX_LATE_LINES = 60;

export interface ReportResult {
  readonly fileName: string;
  readonly contentBase64: string;
  readonly occurrenceCount: number;
  readonly fingerprint: string;
}

export interface ReportContext {
  readonly generatedBy: string;
  readonly scopeLabel: string;
  readonly labels: ReportLabels;
  readonly lateReasonOf: (code: string | null) => string;
  readonly unassigned: string;
}

/**
 * Empreinte du périmètre agrégé.
 *
 * ⚠️ Calculée sur les FAITS, pas sur le PDF : identifiant, statut, échéance et
 * date de dépôt de chaque occurrence. Hacher le fichier produirait une empreinte
 * différente à chaque tirage — l'horodatage imprimé en tête suffit à la faire
 * changer — et ne dirait donc rien des données. Ici, deux rapports d'un même
 * périmètre inchangé portent la même empreinte, et c'est précisément
 * l'information utile.
 */
export function fingerprintScope(
  rows: readonly {
    readonly occurrenceId: string;
    readonly status: string;
    readonly legalDueDate: string;
    readonly submittedAt: string | null;
  }[],
): string {
  const hash = createHash("sha256");

  // Trié : l'ordre de la base ne doit pas changer l'empreinte.
  for (const row of [...rows].sort((left, right) =>
    left.occurrenceId.localeCompare(right.occurrenceId),
  )) {
    hash.update(`${row.occurrenceId}|${row.status}|${row.legalDueDate}|${row.submittedAt ?? ""}\n`);
  }

  return hash.digest("hex");
}

export async function buildComplianceReport(
  filters: ExportScopeFilters,
  context: ReportContext,
  now: Date = new Date(),
): Promise<Result<ReportResult>> {
  const scope = await loadMyExportScope(filters);
  if (!scope.ok) return err(scope.error);

  if (scope.value.length === 0) {
    return err(AppError.validationFailed({ reason: "EXPORT_EMPTY" }));
  }

  const rows = scope.value;
  const compliance = computeCompliance(rows);
  const { lines: causes, lateTotal } = computeLateReasons(rows);

  const submitted = rows.filter((row) => row.submittedAt !== null).length;
  const onTime = rows.filter((row) => row.submittedAt !== null && (row.lateDays ?? 0) === 0).length;

  const lateRows = rows
    .filter((row) => (row.lateDays ?? 0) > 0)
    .sort((left, right) => (right.lateDays ?? 0) - (left.lateDays ?? 0));

  const fingerprint = fingerprintScope(rows);

  const data: ReportData = {
    fromLabel:
      filters.from === undefined ? "—" : formatDateFr(new Date(`${filters.from}T12:00:00Z`)),
    toLabel: filters.to === undefined ? "—" : formatDateFr(new Date(`${filters.to}T12:00:00Z`)),
    totalOccurrences: rows.length,
    submitted,
    onTime,
    late: lateTotal,
    pending: rows.length - submitted,
    onTimeRate: submitted === 0 ? null : onTime / submitted,
    byObligation: compliance.map((line) => ({
      code: line.code,
      name: line.name,
      total: line.total,
      onTime: line.onTime,
      late: line.late,
      pending: line.pending,
      rate: line.rate,
    })),
    lateLines: lateRows.slice(0, MAX_LATE_LINES).map((row) => ({
      code: row.obligationCode,
      name: row.obligationName,
      period: row.periodKey,
      dueDate: formatDateFr(new Date(`${row.legalDueDate}T12:00:00Z`)),
      days: row.lateDays ?? 0,
      // Le motif LIBRE d'abord, la catégorie ensuite : un rapport lu par un
      // dirigeant a besoin de la phrase, pas du code d'énumération.
      reason: row.lateReason ?? context.lateReasonOf(row.lateReasonCode),
      owner: row.ownerName ?? context.unassigned,
    })),
    lateHidden: Math.max(lateRows.length - MAX_LATE_LINES, 0),
    causes: causes.map((cause) => ({
      label: context.lateReasonOf(cause.code === "UNSPECIFIED" ? null : cause.code),
      count: cause.count,
      share: cause.share,
    })),
    generatedBy: context.generatedBy,
    generatedAtLabel: formatDateTimeFr(now),
    scopeLabel: context.scopeLabel,
    fingerprint,
  };

  const bytes = await renderToBuffer(ComplianceReport({ data, labels: context.labels }));

  return ok({
    fileName: `rapport-conformite-${now.toISOString().slice(0, 10)}.pdf`,
    contentBase64: Buffer.from(bytes).toString("base64"),
    occurrenceCount: rows.length,
    fingerprint,
  });
}
