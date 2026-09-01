import "server-only";

/**
 * Écran de travail des occurrences — orchestration.
 *
 * ⚠️ Aucun branchement sur un code d'obligation. Cet écran ne sait pas ce qu'est
 * un G50 : il affiche des lignes (cf. CLAUDE.md §3.5).
 */

import { addDays, endOfMonth, startOfMonth } from "date-fns";

import {
  getOccurrenceStats,
  listCalendarWindow,
  listForExport,
  listOccurrencePage,
  type OccurrenceListRow,
  type OccurrenceStatRow,
} from "@/data/queries/occurrence-list";
import { reassignOccurrenceBatch } from "@/data/mutations/occurrences";
import { loadViewPreferences, saveViewPreferences } from "@/data/queries/view-preferences";
import { formatISODateInAppTz, nowInAppTz, toUtcFromAppTz } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { requireAuthContext, requirePermission } from "@/services/auth/context";
import {
  OccurrenceFiltersSchema,
  persistableFilters,
  type OccurrenceFilters,
} from "@/services/occurrences/filters";
import { toObligationTypeId, toProfileId, type CursorPage } from "@/types/domain";

export * from "@/services/occurrences/filters";
export type { OccurrenceListRow, OccurrenceStatRow };

/** Clé de mémorisation des filtres. Stable, indépendante du routage. */
const VIEW_KEY = "occurrences";

// ─── Liste ───────────────────────────────────────────────────────────────────

export interface OccurrenceListView {
  readonly page: CursorPage<OccurrenceListRow>;
  readonly filters: OccurrenceFilters;
  /** Vrai si les filtres viennent de la mémorisation et non de l'URL. */
  readonly restoredFromPreferences: boolean;
}

/**
 * Page de la liste.
 *
 * Les filtres viennent de l'URL. Si l'URL n'en porte AUCUN, on restaure les
 * derniers utilisés — mais jamais l'inverse : une URL partagée doit montrer à
 * son destinataire exactement ce que son auteur voyait, sans qu'une préférence
 * personnelle vienne s'y superposer.
 */
export async function listOccurrences(
  filters: OccurrenceFilters,
  options: { readonly urlHadFilters: boolean } = { urlHadFilters: true },
): Promise<Result<OccurrenceListView>> {
  const context = await requirePermission("occurrence.read");
  if (!context.ok) return context;

  let effective = filters;
  let restored = false;

  if (!options.urlHadFilters) {
    const saved = await loadViewPreferences(context.value.userId, VIEW_KEY);
    if (saved.ok && saved.value !== null) {
      const parsed = OccurrenceFiltersSchema.safeParse(saved.value);
      if (parsed.success) {
        effective = parsed.data;
        restored = true;
      }
    }
  }

  const page = await listOccurrencePage(effective, context.value.userId);
  if (!page.ok) return page;

  return ok({ page: page.value, filters: effective, restoredFromPreferences: restored });
}

/** Mémorise les filtres courants. Échec silencieux : c'est un confort, pas une donnée. */
export async function rememberFilters(filters: OccurrenceFilters): Promise<Result<null>> {
  const context = await requireAuthContext();
  if (!context.ok) return context;

  return saveViewPreferences(context.value.userId, VIEW_KEY, persistableFilters(filters));
}

// ─── Agrégats ────────────────────────────────────────────────────────────────

export interface OccurrenceSummary {
  readonly total: number;
  readonly overdue: number;
  readonly internallyLate: number;
  readonly dueWithinWeek: number;
  readonly byStatus: Readonly<Record<string, number>>;
}

/**
 * Compteurs de tête d'écran.
 *
 * ⚠️ Issus de la vue matérialisée, jamais d'un COUNT sur la table. Ils datent
 * donc d'au plus quinze minutes — sans conséquence sur une granularité
 * journalière, et l'écran le dit.
 */
export async function getSummary(): Promise<Result<OccurrenceSummary>> {
  const context = await requirePermission("occurrence.read");
  if (!context.ok) return context;

  const stats = await getOccurrenceStats();
  if (!stats.ok) return stats;

  const byStatus: Record<string, number> = {};
  let total = 0;
  let overdue = 0;
  let internallyLate = 0;
  let dueWithinWeek = 0;

  for (const row of stats.value) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + row.total;
    total += row.total;
    overdue += row.overdue;
    internallyLate += row.internallyLate;
    dueWithinWeek += row.dueWithinWeek;
  }

  return ok({ total, overdue, internallyLate, dueWithinWeek, byStatus });
}

// ─── Calendrier ──────────────────────────────────────────────────────────────

export type CalendarScale = "month" | "quarter" | "year";

export interface CalendarView {
  readonly from: string;
  readonly to: string;
  readonly scale: CalendarScale;
  readonly items: readonly OccurrenceListRow[];
}

/** Bornes de la fenêtre affichée, calendrier d'Alger. */
export function calendarWindow(
  anchor: Date,
  scale: CalendarScale,
): { readonly from: string; readonly to: string } {
  if (scale === "year") {
    return {
      from: formatISODateInAppTz(toUtcFromAppTz(new Date(anchor.getFullYear(), 0, 1, 12))),
      to: formatISODateInAppTz(toUtcFromAppTz(new Date(anchor.getFullYear(), 11, 31, 12))),
    };
  }
  if (scale === "quarter") {
    const firstMonth = Math.floor(anchor.getMonth() / 3) * 3;
    const start = new Date(anchor.getFullYear(), firstMonth, 1, 12);
    const end = endOfMonth(new Date(anchor.getFullYear(), firstMonth + 2, 1, 12));
    return {
      from: formatISODateInAppTz(toUtcFromAppTz(start)),
      to: formatISODateInAppTz(toUtcFromAppTz(end)),
    };
  }
  return {
    from: formatISODateInAppTz(toUtcFromAppTz(startOfMonth(anchor))),
    to: formatISODateInAppTz(toUtcFromAppTz(endOfMonth(anchor))),
  };
}

/** ⚠️ UNE seule requête pour toute la fenêtre affichée, quelle que soit l'échelle. */
export async function getCalendar(
  anchorIso: string | undefined,
  scale: CalendarScale,
  filters: OccurrenceFilters,
): Promise<Result<CalendarView>> {
  const context = await requirePermission("occurrence.read");
  if (!context.ok) return context;

  const anchor =
    anchorIso === undefined || anchorIso.length === 0
      ? nowInAppTz()
      : new Date(`${anchorIso}T12:00:00.000Z`);

  if (Number.isNaN(anchor.getTime())) {
    return err(AppError.validationFailed({ field: "anchor", reason: "DATE_INVALID" }));
  }

  const { from, to } = calendarWindow(anchor, scale);
  const items = await listCalendarWindow(from, to, filters, context.value.userId);
  if (!items.ok) return items;

  return ok({ from, to, scale, items: items.value });
}

// ─── Mes tâches ──────────────────────────────────────────────────────────────

export type TaskBucket = "overdue" | "thisWeek" | "thisMonth" | "later" | "awaitingMe";

export interface TaskGroup {
  readonly bucket: TaskBucket;
  readonly items: readonly OccurrenceListRow[];
}

/** Rang de criticité, du plus grave au moins grave. */
const CRITICALITY_RANK: Readonly<Record<string, number>> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

/**
 * Tri par URGENCE puis CRITICITÉ.
 *
 * L'urgence d'abord : un dossier peu critique dû demain passe avant un dossier
 * critique dû dans trois semaines. La criticité départage à échéance égale.
 */
function byUrgencyThenCriticality(left: OccurrenceListRow, right: OccurrenceListRow): number {
  if (left.daysToInternal !== right.daysToInternal) {
    return left.daysToInternal - right.daysToInternal;
  }
  const rank =
    (CRITICALITY_RANK[left.criticality] ?? 9) - (CRITICALITY_RANK[right.criticality] ?? 9);
  if (rank !== 0) return rank;
  return left.obligationCode.localeCompare(right.obligationCode, "fr");
}

/**
 * Mes tâches, groupées.
 *
 * « En attente de mon action » réunit ce qui m'est confié ET ce qui attend ma
 * validation : ce sont deux rôles distincts sur un même écran, et une personne
 * qui valide n'a pas à chercher ailleurs ce qu'on lui demande.
 */
export async function getMyTasks(): Promise<Result<readonly TaskGroup[]>> {
  const context = await requireAuthContext();
  if (!context.ok) return context;

  const userId = context.value.userId;
  const today = nowInAppTz();
  const weekEnd = formatISODateInAppTz(toUtcFromAppTz(addDays(today, 7)));
  const monthEnd = formatISODateInAppTz(toUtcFromAppTz(addDays(today, 30)));

  // Une seule requête : tout ce qui me concerne, sur un horizon large. Le
  // regroupement se fait ensuite en mémoire, sur quelques dizaines de lignes.
  const mine = await listOccurrencePage(
    OccurrenceFiltersSchema.parse({ sort: "internal_due_date", direction: "asc" }),
    userId,
  );
  if (!mine.ok) return mine;

  const relevant = mine.value.items.filter(
    (row) =>
      (row.ownerId === userId || row.validatorId === userId) &&
      !["ARCHIVED", "SUBMITTED", "NOT_APPLICABLE"].includes(row.status),
  );

  const buckets: Record<TaskBucket, OccurrenceListRow[]> = {
    overdue: [],
    thisWeek: [],
    thisMonth: [],
    later: [],
    awaitingMe: [],
  };

  for (const row of relevant) {
    if (row.validatorId === userId && row.status === "PENDING_VALIDATION") {
      buckets.awaitingMe.push(row);
      continue;
    }
    if (row.isOverdue || row.isInternallyLate) buckets.overdue.push(row);
    else if (row.internalDueDate <= weekEnd) buckets.thisWeek.push(row);
    else if (row.internalDueDate <= monthEnd) buckets.thisMonth.push(row);
    else buckets.later.push(row);
  }

  const order: readonly TaskBucket[] = ["overdue", "awaitingMe", "thisWeek", "thisMonth", "later"];

  return ok(
    order.map((bucket) => ({
      bucket,
      items: [...buckets[bucket]].sort(byUrgencyThenCriticality),
    })),
  );
}

// ─── Réaffectation groupée ───────────────────────────────────────────────────

export async function reassign(
  occurrenceIds: readonly string[],
  ownerId: string,
): Promise<Result<{ readonly updated: number }>> {
  const context = await requirePermission("occurrence.assign");
  if (!context.ok) return context;

  if (occurrenceIds.length === 0) {
    return err(AppError.validationFailed({ reason: "NO_SELECTION" }));
  }
  // Borne : une sélection de plusieurs milliers de lignes est une erreur de
  // manipulation, pas une intention.
  if (occurrenceIds.length > 500) {
    return err(AppError.validationFailed({ reason: "SELECTION_TOO_LARGE" }));
  }

  const updated = await reassignOccurrenceBatch(occurrenceIds, toProfileId(ownerId));
  if (!updated.ok) return updated;

  return ok({ updated: updated.value });
}

// ─── Export ──────────────────────────────────────────────────────────────────

export async function exportRows(
  filters: OccurrenceFilters,
): Promise<Result<readonly OccurrenceListRow[]>> {
  const context = await requirePermission("export.generate");
  if (!context.ok) return context;

  return listForExport(filters, context.value.userId);
}

/** Réexporté pour l'écran de détail à venir ; évite d'importer la couche data. */
export { toObligationTypeId };
