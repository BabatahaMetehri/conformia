import "server-only";

/**
 * EXPORTS TABULAIRES — quatre tableaux, deux formats.
 *
 * ⚠️ TOUS PARTENT DU MÊME PÉRIMÈTRE : `loadMyExportScope`, qui interroge la base
 * dans la session de l'appelant. Les quatre tableaux sont des AGRÉGATIONS de ce
 * périmètre, calculées ici. Aucun d'eux ne repart en base avec ses propres
 * filtres — c'est ce qui garantit qu'ils disent tous la même chose, et qu'un RH
 * qui demande « tout » obtient le domaine social dans les quatre.
 */

import { buildCsv } from "@/lib/csv";
import { buildSheetWorkbook, type CellValue, type Sheet } from "@/lib/workbook";
import { err, ok, type Result } from "@/lib/result";
import { AppError } from "@/lib/errors";
import {
  loadMyExportScope,
  type ExportableOccurrence,
  type ExportKind,
  type ExportScopeFilters,
} from "@/data/queries/export";

export type TabularKind = "OCCURRENCES" | "COMPLIANCE" | "WORKLOAD" | "LATE_REASONS";
export type TabularFormat = "XLSX" | "CSV";

export interface TabularExport {
  readonly fileName: string;
  /** Base64 : une Server Action ne transporte pas d'octets bruts. */
  readonly contentBase64: string;
  readonly rowCount: number;
  readonly occurrenceCount: number;
  readonly kind: ExportKind;
}

/** Libellés fournis par l'appelant : ce module n'a pas de catalogue i18n. */
export interface TabularLabels {
  readonly sheetName: (kind: TabularKind) => string;
  readonly headers: Readonly<Record<TabularKind, readonly string[]>>;
  readonly statusOf: (status: string) => string;
  readonly criticalityOf: (criticality: string) => string;
  readonly lateReasonOf: (code: string | null) => string;
  readonly unassigned: string;
  readonly onTime: string;
  readonly late: string;
  readonly pending: string;
}

/**
 * Date civile pour un tableur.
 *
 * ⚠️ Reconstruite à MIDI UTC. La colonne est un `date` PostgreSQL sans heure :
 * à minuit, la moindre conversion de fuseau la ferait basculer d'un jour, et le
 * tableur afficherait la veille de l'échéance.
 */
function spreadsheetDate(iso: string | null): Date | null {
  if (iso === null || iso.length === 0) return null;
  const date = new Date(`${iso.slice(0, 10)}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

// ─── 1. Suivi des occurrences ────────────────────────────────────────────────

function occurrencesSheet(
  rows: readonly ExportableOccurrence[],
  labels: TabularLabels,
): { columns: Sheet["columns"]; body: CellValue[][] } {
  const columns = [
    { header: "", width: 14 },
    { header: "", width: 36 },
    { header: "", width: 14 },
    { header: "", width: 20 },
    { header: "", width: 12 },
    { header: "", width: 14, format: "date" as const },
    { header: "", width: 14, format: "date" as const },
    { header: "", width: 18 },
    { header: "", width: 14 },
    { header: "", width: 24 },
    { header: "", width: 24 },
    { header: "", width: 16, format: "date" as const },
    { header: "", width: 10, format: "integer" as const },
    { header: "", width: 22 },
    { header: "", width: 10, format: "integer" as const },
  ].map((column, index) => ({ ...column, header: labels.headers.OCCURRENCES[index] ?? "" }));

  const body: CellValue[][] = rows.map((row) => [
    row.obligationCode,
    row.obligationName,
    row.domainCode,
    row.authorityName,
    row.periodKey,
    spreadsheetDate(row.internalDueDate),
    spreadsheetDate(row.legalDueDate),
    labels.statusOf(row.status),
    labels.criticalityOf(row.criticality),
    row.ownerName,
    row.validatorName,
    spreadsheetDate(row.submittedAt),
    row.lateDays,
    labels.lateReasonOf(row.lateReasonCode),
    row.documentCount,
  ]);

  return { columns, body };
}

// ─── 2. Tableau de conformité ────────────────────────────────────────────────

interface ComplianceLine {
  readonly code: string;
  readonly name: string;
  readonly domain: string;
  readonly total: number;
  readonly submitted: number;
  readonly onTime: number;
  readonly late: number;
  readonly pending: number;
  readonly rate: number | null;
}

/**
 * Taux de conformité par obligation.
 *
 * ⚠️ Le taux se calcule sur les dossiers DÉPOSÉS, pas sur tous. Un exercice en
 * cours contient des dossiers dont l'échéance n'est pas venue : les compter comme
 * non conformes ferait chuter le taux pour la seule raison que le temps n'a pas
 * passé. Le nombre en attente est donné à part — c'est une information, pas un
 * échec.
 */
export function computeCompliance(rows: readonly ExportableOccurrence[]): ComplianceLine[] {
  const byObligation = new Map<string, ComplianceLine>();

  for (const row of rows) {
    const existing = byObligation.get(row.obligationCode) ?? {
      code: row.obligationCode,
      name: row.obligationName,
      domain: row.domainCode,
      total: 0,
      submitted: 0,
      onTime: 0,
      late: 0,
      pending: 0,
      rate: null,
    };

    const isSubmitted = row.submittedAt !== null;
    const isLate = (row.lateDays ?? 0) > 0;

    byObligation.set(row.obligationCode, {
      ...existing,
      total: existing.total + 1,
      submitted: existing.submitted + (isSubmitted ? 1 : 0),
      onTime: existing.onTime + (isSubmitted && !isLate ? 1 : 0),
      late: existing.late + (isSubmitted && isLate ? 1 : 0),
      pending: existing.pending + (isSubmitted ? 0 : 1),
      rate: null,
    });
  }

  return [...byObligation.values()]
    .map((line) => ({
      ...line,
      rate: line.submitted === 0 ? null : line.onTime / line.submitted,
    }))
    .sort((left, right) => left.code.localeCompare(right.code));
}

// ─── 3. Charge par personne ──────────────────────────────────────────────────

interface WorkloadLine {
  readonly person: string;
  readonly total: number;
  readonly open: number;
  readonly overdue: number;
  readonly submitted: number;
  readonly late: number;
}

const OPEN_STATUSES = new Set(["TODO", "IN_PROGRESS", "PENDING_VALIDATION", "REJECTED"]);

export function computeWorkload(
  rows: readonly ExportableOccurrence[],
  unassigned: string,
  today: string,
): WorkloadLine[] {
  const byPerson = new Map<string, WorkloadLine>();

  for (const row of rows) {
    // Un dossier sans porteur COMPTE, sous un libellé explicite. L'écarter
    // ferait disparaître du tableau exactement les dossiers dont personne ne
    // s'occupe — ceux qu'il faut voir en premier.
    const person = row.ownerName ?? unassigned;
    const existing = byPerson.get(person) ?? {
      person,
      total: 0,
      open: 0,
      overdue: 0,
      submitted: 0,
      late: 0,
    };

    const isOpen = OPEN_STATUSES.has(row.status);

    byPerson.set(person, {
      person,
      total: existing.total + 1,
      open: existing.open + (isOpen ? 1 : 0),
      overdue: existing.overdue + (isOpen && row.internalDueDate < today ? 1 : 0),
      submitted: existing.submitted + (row.submittedAt === null ? 0 : 1),
      late: existing.late + ((row.lateDays ?? 0) > 0 ? 1 : 0),
    });
  }

  return [...byPerson.values()].sort((left, right) => right.open - left.open);
}

// ─── 4. Analyse des motifs de retard ─────────────────────────────────────────

interface LateReasonLine {
  readonly code: string;
  readonly count: number;
  readonly share: number;
  readonly totalDays: number;
  readonly averageDays: number;
}

export function computeLateReasons(rows: readonly ExportableOccurrence[]): {
  lines: LateReasonLine[];
  lateTotal: number;
} {
  const late = rows.filter((row) => (row.lateDays ?? 0) > 0);
  const byReason = new Map<string, { count: number; days: number }>();

  for (const row of late) {
    // `null` devient une catégorie à part entière : « motif non renseigné » est
    // un résultat d'analyse, et souvent le plus gros bloc du tableau.
    const key = row.lateReasonCode ?? "UNSPECIFIED";
    const existing = byReason.get(key) ?? { count: 0, days: 0 };
    byReason.set(key, {
      count: existing.count + 1,
      days: existing.days + (row.lateDays ?? 0),
    });
  }

  const lines = [...byReason.entries()]
    .map(([code, value]) => ({
      code,
      count: value.count,
      share: late.length === 0 ? 0 : value.count / late.length,
      totalDays: value.days,
      averageDays: value.count === 0 ? 0 : Math.round((value.days / value.count) * 10) / 10,
    }))
    .sort((left, right) => right.count - left.count);

  return { lines, lateTotal: late.length };
}

// ─── Assemblage ──────────────────────────────────────────────────────────────

interface Table {
  readonly columns: Sheet["columns"];
  readonly body: CellValue[][];
}

function buildTable(
  kind: TabularKind,
  rows: readonly ExportableOccurrence[],
  labels: TabularLabels,
  today: string,
): Table {
  switch (kind) {
    case "OCCURRENCES":
      return occurrencesSheet(rows, labels);

    case "COMPLIANCE": {
      const widths = [14, 36, 14, 10, 12, 12, 10, 12, 12] as const;
      const formats = [
        "text",
        "text",
        "text",
        "integer",
        "integer",
        "integer",
        "integer",
        "integer",
        "percent",
      ] as const;
      return {
        columns: widths.map((width, index) => ({
          header: labels.headers.COMPLIANCE[index] ?? "",
          width,
          format: formats[index] ?? "text",
        })),
        body: computeCompliance(rows).map((line) => [
          line.code,
          line.name,
          line.domain,
          line.total,
          line.submitted,
          line.onTime,
          line.late,
          line.pending,
          line.rate,
        ]),
      };
    }

    case "WORKLOAD": {
      const widths = [30, 10, 10, 12, 12, 10] as const;
      const formats = ["text", "integer", "integer", "integer", "integer", "integer"] as const;
      return {
        columns: widths.map((width, index) => ({
          header: labels.headers.WORKLOAD[index] ?? "",
          width,
          format: formats[index] ?? "text",
        })),
        body: computeWorkload(rows, labels.unassigned, today).map((line) => [
          line.person,
          line.total,
          line.open,
          line.overdue,
          line.submitted,
          line.late,
        ]),
      };
    }

    case "LATE_REASONS": {
      const widths = [30, 10, 12, 14, 14] as const;
      const formats = ["text", "integer", "percent", "integer", "decimal"] as const;
      return {
        columns: widths.map((width, index) => ({
          header: labels.headers.LATE_REASONS[index] ?? "",
          width,
          format: formats[index] ?? "text",
        })),
        body: computeLateReasons(rows).lines.map((line) => [
          labels.lateReasonOf(line.code === "UNSPECIFIED" ? null : line.code),
          line.count,
          line.share,
          line.totalDays,
          line.averageDays,
        ]),
      };
    }
  }
}

const KIND_TO_EXPORT: Readonly<Record<TabularKind, ExportKind>> = {
  OCCURRENCES: "OCCURRENCES",
  COMPLIANCE: "COMPLIANCE",
  WORKLOAD: "WORKLOAD",
  LATE_REASONS: "LATE_REASONS",
};

const KIND_TO_SLUG: Readonly<Record<TabularKind, string>> = {
  OCCURRENCES: "suivi-occurrences",
  COMPLIANCE: "conformite",
  WORKLOAD: "charge-par-personne",
  LATE_REASONS: "motifs-de-retard",
};

/**
 * Produit un tableau, dans le format demandé.
 *
 * ⚠️ Un périmètre VIDE est une erreur, pas un fichier vide. Un classeur sans
 * ligne se télécharge, s'ouvre, et laisse croire qu'il n'y avait rien à
 * déclarer — alors que le filtre était peut-être trop étroit. Mieux vaut le dire.
 */
export async function buildTabularExport(
  kind: TabularKind,
  format: TabularFormat,
  filters: ExportScopeFilters,
  labels: TabularLabels,
  now: Date = new Date(),
): Promise<Result<TabularExport>> {
  const scope = await loadMyExportScope(filters);
  if (!scope.ok) return err(scope.error);

  if (scope.value.length === 0) {
    return err(AppError.validationFailed({ reason: "EXPORT_EMPTY" }));
  }

  const today = now.toISOString().slice(0, 10);
  const table = buildTable(kind, scope.value, labels, today);
  const stamp = now.toISOString().slice(0, 10);
  const base = `${KIND_TO_SLUG[kind]}-${stamp}`;

  if (format === "CSV") {
    const csv = buildCsv({
      headers: table.columns.map((column) => column.header),
      // Les valeurs du tableur et celles du CSV sont les MÊMES : seuls les
      // formats diffèrent. Deux jeux de données divergeraient au premier ajout
      // de colonne.
      rows: table.body,
    });

    return ok({
      fileName: `${base}.csv`,
      contentBase64: Buffer.from(csv, "utf8").toString("base64"),
      rowCount: table.body.length,
      occurrenceCount: scope.value.length,
      kind: KIND_TO_EXPORT[kind],
    });
  }

  const bytes = await buildSheetWorkbook({
    name: labels.sheetName(kind),
    columns: table.columns,
    rows: table.body,
  });

  return ok({
    fileName: `${base}.xlsx`,
    contentBase64: Buffer.from(bytes).toString("base64"),
    rowCount: table.body.length,
    occurrenceCount: scope.value.length,
    kind: KIND_TO_EXPORT[kind],
  });
}
