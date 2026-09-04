"use server";

/**
 * Server Actions de la page Rapports.
 *
 * ⚠️ AUCUNE ACTION NE DÉCIDE DU PÉRIMÈTRE. Elles transmettent des filtres ; c'est
 * `my_exportable_occurrences` — donc la base, dans la session de l'appelant — qui
 * décide de ce qui sort. Un filtrage fait ici serait un second cloisonnement,
 * c'est-à-dire un second endroit où il pourrait devenir faux.
 */

import { z } from "zod";

import { DEFAULT_LOCALE } from "@/config/constants";
import { appTranslator } from "@/lib/translator";
import { AppError, toClientError } from "@/lib/errors";
import {
  describeScope,
  loadExportHistory,
  planPeriodicExport,
  produceReport,
  produceRegisterReport,
  produceTabular,
  type ExportScopeFilters,
  type TabularLabels,
} from "@/services/export";
import type { DownloadOutcome, HistoryOutcome, PeriodOutcome } from "./types";
import { uuidSchema } from "@/lib/schemas";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const filterSchema = z.object({
  from: z.string().regex(ISO_DATE).optional(),
  to: z.string().regex(ISO_DATE).optional(),
  domainId: uuidSchema.optional(),
  authorityId: uuidSchema.optional(),
});

const tabularSchema = filterSchema.extend({
  kind: z.enum(["OCCURRENCES", "COMPLIANCE", "WORKLOAD", "LATE_REASONS"]),
  format: z.enum(["XLSX", "CSV"]),
});

function toFilters(parsed: z.infer<typeof filterSchema>): ExportScopeFilters {
  // Les champs absents sont OMIS : `exactOptionalPropertyTypes` refuse un
  // `undefined` explicite, et le SQL applique alors son défaut NULL.
  return {
    ...(parsed.from === undefined ? {} : { from: parsed.from }),
    ...(parsed.to === undefined ? {} : { to: parsed.to }),
    ...(parsed.domainId === undefined ? {} : { domainId: parsed.domainId }),
    ...(parsed.authorityId === undefined ? {} : { authorityId: parsed.authorityId }),
  };
}

/**
 * ⚠️ Clés i18n ÉCRITES EN TOUTES LETTRES. Une clé composée compile mais échappe
 * au typage de next-intl : un statut renommé produirait une colonne vide dans un
 * fichier déjà envoyé à un contrôleur.
 */
const STATUS_KEYS = {
  TODO: "occurrences.status.TODO",
  IN_PROGRESS: "occurrences.status.IN_PROGRESS",
  PENDING_VALIDATION: "occurrences.status.PENDING_VALIDATION",
  REJECTED: "occurrences.status.REJECTED",
  VALIDATED: "occurrences.status.VALIDATED",
  SUBMITTED: "occurrences.status.SUBMITTED",
  ARCHIVED: "occurrences.status.ARCHIVED",
  NOT_APPLICABLE: "occurrences.status.NOT_APPLICABLE",
} as const;

const CRITICALITY_KEYS = {
  LOW: "obligations.criticality.LOW",
  MEDIUM: "obligations.criticality.MEDIUM",
  HIGH: "obligations.criticality.HIGH",
  CRITICAL: "obligations.criticality.CRITICAL",
} as const;

const LATE_REASON_KEYS = {
  MISSING_DOCUMENT: "occurrences.detail.lateReasons.MISSING_DOCUMENT",
  VALIDATOR_UNAVAILABLE: "occurrences.detail.lateReasons.VALIDATOR_UNAVAILABLE",
  LATE_EXTERNAL_INFORMATION: "occurrences.detail.lateReasons.LATE_EXTERNAL_INFORMATION",
  OVERSIGHT: "occurrences.detail.lateReasons.OVERSIGHT",
  OTHER: "occurrences.detail.lateReasons.OTHER",
} as const;

const SHEET_KEYS = {
  OCCURRENCES: "exports.sheets.OCCURRENCES",
  COMPLIANCE: "exports.sheets.COMPLIANCE",
  WORKLOAD: "exports.sheets.WORKLOAD",
  LATE_REASONS: "exports.sheets.LATE_REASONS",
} as const;

function known<T extends Record<string, string>>(
  table: T,
  value: string,
): value is Extract<keyof T, string> {
  return Object.hasOwn(table, value);
}

function tabularLabels(): TabularLabels {
  const t = appTranslator(DEFAULT_LOCALE);
  const column = {
    code: t("exports.columns.code"),
    obligation: t("exports.columns.obligation"),
    domain: t("exports.columns.domain"),
    authority: t("exports.columns.authority"),
    period: t("exports.columns.period"),
    internalDue: t("exports.columns.internalDue"),
    legalDue: t("exports.columns.legalDue"),
    status: t("exports.columns.status"),
    criticality: t("exports.columns.criticality"),
    owner: t("exports.columns.owner"),
    validator: t("exports.columns.validator"),
    submittedAt: t("exports.columns.submittedAt"),
    lateDays: t("exports.columns.lateDays"),
    lateReason: t("exports.columns.lateReason"),
    documents: t("exports.columns.documents"),
    total: t("exports.columns.total"),
    submitted: t("exports.columns.submitted"),
    onTime: t("exports.columns.onTime"),
    late: t("exports.columns.late"),
    pending: t("exports.columns.pending"),
    rate: t("exports.columns.rate"),
    person: t("exports.columns.person"),
    open: t("exports.columns.open"),
    overdue: t("exports.columns.overdue"),
    count: t("exports.columns.count"),
    share: t("exports.columns.share"),
    totalDays: t("exports.columns.totalDays"),
    averageDays: t("exports.columns.averageDays"),
  };

  return {
    sheetName: (kind) => t(SHEET_KEYS[kind]),
    headers: {
      OCCURRENCES: [
        column.code,
        column.obligation,
        column.domain,
        column.authority,
        column.period,
        column.internalDue,
        column.legalDue,
        column.status,
        column.criticality,
        column.owner,
        column.validator,
        column.submittedAt,
        column.lateDays,
        column.lateReason,
        column.documents,
      ],
      COMPLIANCE: [
        column.code,
        column.obligation,
        column.domain,
        column.total,
        column.submitted,
        column.onTime,
        column.late,
        column.pending,
        column.rate,
      ],
      WORKLOAD: [
        column.person,
        column.total,
        column.open,
        column.overdue,
        column.submitted,
        column.late,
      ],
      LATE_REASONS: [
        column.lateReason,
        column.count,
        column.share,
        column.totalDays,
        column.averageDays,
      ],
    },
    statusOf: (status) => (known(STATUS_KEYS, status) ? t(STATUS_KEYS[status]) : status),
    criticalityOf: (value) => (known(CRITICALITY_KEYS, value) ? t(CRITICALITY_KEYS[value]) : value),
    lateReasonOf: (code) =>
      code === null
        ? t("common.notProvided")
        : known(LATE_REASON_KEYS, code)
          ? t(LATE_REASON_KEYS[code])
          : code,
    unassigned: t("common.notProvided"),
    onTime: column.onTime,
    late: column.late,
    pending: column.pending,
  };
}

export async function exportTabularAction(input: unknown): Promise<DownloadOutcome> {
  const parsed = tabularSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      error: toClientError(AppError.validationFailed({ field: "filters" })),
    };
  }

  const { kind, format, ...rest } = parsed.data;
  const produced = await produceTabular(kind, format, toFilters(rest), tabularLabels());

  return produced.ok
    ? { status: "success", data: produced.value }
    : { status: "error", error: toClientError(produced.error) };
}

/**
 * Rapport « Situation par registre ».
 *
 * ⚠️ AUCUN FILTRE DE PÉRIMÈTRE, et c'est cohérent : le rapport porte sur TOUS
 * les registres visibles de l'appelant, un par ligne. Le filtrer par domaine ou
 * par période reviendrait à mesurer autre chose que ce qu'il annonce.
 *
 * ⚠️ MESURE EXCLUSIVE : le taux de chaque établissement écarte les obligations
 * valant pour toute l'entreprise. La mention est portée DANS le fichier.
 */
const registerReportSchema = z.object({ format: z.enum(["CSV", "XLSX"]) });

export async function exportRegisterReportAction(input: unknown): Promise<DownloadOutcome> {
  const parsed = registerReportSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      error: toClientError(AppError.validationFailed({ field: "format" })),
    };
  }

  const t = appTranslator(DEFAULT_LOCALE);
  const produced = await produceRegisterReport(parsed.data.format, {
    sheetName: t("registers.title"),
    headers: [
      t("registers.columns.rcNumber"),
      t("registers.columns.label"),
      t("registers.columns.wilaya"),
      t("registers.columns.status"),
      t("registers.compliance.total"),
      t("registers.compliance.submitted"),
      t("dashboard.overdue"),
      t("registers.compliance.rate"),
      t("registers.columns.expiresAt"),
    ],
    scopeNotice: t("registers.scope.exclusive"),
  });

  return produced.ok
    ? { status: "success", data: produced.value }
    : { status: "error", error: toClientError(produced.error) };
}

export async function exportReportAction(input: unknown): Promise<DownloadOutcome> {
  const parsed = filterSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      error: toClientError(AppError.validationFailed({ field: "filters" })),
    };
  }

  const t = appTranslator(DEFAULT_LOCALE);
  const filters = toFilters(parsed.data);
  const labels = tabularLabels();

  const produced = await produceReport(filters, {
    // ⚠️ L'auteur vient de la SESSION, jamais du formulaire : une signature de
    // génération qu'on peut choisir ne signe rien.
    generatedBy: await currentUserLabel(),
    scopeLabel: describeScope(filters, t("exports.common.unbounded")),
    lateReasonOf: labels.lateReasonOf,
    unassigned: labels.unassigned,
    labels: {
      title: t("exports.report.title"),
      subtitle: (from, to) => t("exports.report.subtitle", { from, to }),
      page: (current, total) => t("exports.common.page", { current, total }),
      summary: t("exports.report.summary"),
      totalOccurrences: t("exports.report.totalOccurrences"),
      submitted: t("exports.report.submitted"),
      onTimeRate: t("exports.report.onTimeRate"),
      lateCount: t("exports.report.lateCount"),
      pendingCount: t("exports.report.pendingCount"),
      ofSubmitted: t("exports.report.ofSubmitted"),
      byObligation: t("exports.report.byObligation"),
      code: t("exports.columns.code"),
      obligation: t("exports.columns.obligation"),
      total: t("exports.columns.total"),
      onTime: t("exports.columns.onTime"),
      late: t("exports.columns.late"),
      pending: t("exports.columns.pending"),
      rate: t("exports.columns.rate"),
      lateList: t("exports.report.lateList"),
      period: t("exports.columns.period"),
      dueDate: t("exports.columns.legalDue"),
      days: t("exports.columns.lateDays"),
      reason: t("exports.columns.lateReason"),
      owner: t("exports.columns.owner"),
      noLate: t("exports.report.noLate"),
      causes: t("exports.report.causes"),
      noCause: t("exports.report.noCause"),
      signature: t("exports.report.signature"),
      generatedBy: t("exports.report.generatedBy"),
      generatedAt: t("exports.report.generatedAt"),
      scope: t("exports.report.scope"),
      fingerprint: t("exports.report.fingerprint"),
      fingerprintNote: t("exports.report.fingerprintNote"),
      andMore: (count) => t("exports.report.andMore", { count }),
    },
  });

  return produced.ok
    ? { status: "success", data: produced.value }
    : { status: "error", error: toClientError(produced.error) };
}

export async function planPeriodExportAction(input: unknown): Promise<PeriodOutcome> {
  const parsed = filterSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      error: toClientError(AppError.validationFailed({ field: "filters" })),
    };
  }

  const t = appTranslator(DEFAULT_LOCALE);
  const filters = toFilters(parsed.data);
  const planned = await planPeriodicExport(
    filters,
    describeScope(filters, t("exports.common.unbounded")),
  );

  return planned.ok
    ? { status: "success", data: planned.value }
    : { status: "error", error: toClientError(planned.error) };
}

export async function loadHistoryAction(): Promise<HistoryOutcome> {
  const history = await loadExportHistory();
  return history.ok
    ? { status: "success", data: history.value }
    : { status: "error", error: toClientError(history.error) };
}

/** Nom lisible de l'auteur, pour la signature du rapport. */
async function currentUserLabel(): Promise<string> {
  const { requireAuthContext } = await import("@/services/auth/context");
  const context = await requireAuthContext();
  if (!context.ok) return "—";
  return context.value.profile.fullName ?? context.value.email ?? "—";
}
