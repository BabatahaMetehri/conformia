import "server-only";

/**
 * Tableau de bord.
 *
 * Assemble les agrégats déjà calculés en base et les met en forme pour l'écran.
 * ⚠️ Aucun filtrage d'habilitation ici : les fonctions `*_for_caller()`
 * appliquent le cloisonnement par domaine, et le refaire en TypeScript créerait
 * une seconde règle d'accès qui divergerait de la première.
 *
 * Ce module ne fait donc que trois choses : additionner, ordonner, nommer.
 */

import {
  loadAlerts,
  loadComplianceMonthly,
  loadDomainLabels,
  loadHealth,
  loadLateReasons,
  loadOwnerLabels,
  loadStatusBreakdown,
  loadUpcomingLoad,
  loadWorkload,
} from "@/data/queries/dashboard";
import { ok, type Result } from "@/lib/result";
import { requireAuthContext } from "@/services/auth/context";

/** Statuts portés par le graphique de répartition, dans l'ordre du cycle de vie. */
export const OPEN_STATUSES: readonly string[] = [
  "TODO",
  "IN_PROGRESS",
  "PENDING_VALIDATION",
  "REJECTED",
  "VALIDATED",
];

export interface ComplianceMonth {
  readonly month: string;
  readonly due: number;
  readonly onTime: number;
  /** Pourcentage entier, ou `null` si rien n'était dû ce mois-là. */
  readonly rate: number | null;
}

export interface UpcomingWeek {
  readonly weekStart: string;
  readonly started: number;
  readonly notStarted: number;
}

export interface StatusSlice {
  readonly status: string;
  readonly total: number;
}

export interface DomainComparison {
  readonly domainId: string | null;
  readonly label: string;
  readonly open: number;
  readonly late: number;
}

export interface PersonLoad {
  readonly ownerId: string;
  readonly label: string;
  readonly open: number;
  readonly late: number;
}

export interface LateReasonSlice {
  readonly code: string;
  readonly total: number;
}

export interface DashboardView {
  readonly complianceRate: number | null;
  readonly overdueByCriticality: readonly StatusSlice[];
  readonly dueWithin30Days: number;
  readonly pendingValidation: number;
  readonly pendingAvgDays: number;
  readonly completenessRate: number | null;
  readonly monthly: readonly ComplianceMonth[];
  readonly statuses: readonly StatusSlice[];
  readonly upcoming: readonly UpcomingWeek[];
  readonly domains: readonly DomainComparison[];
  readonly people: readonly PersonLoad[];
  readonly lateReasons: readonly LateReasonSlice[];
  readonly alerts: readonly {
    readonly code: string;
    readonly severity: string;
    readonly total: number;
  }[];
}

/** Pourcentage entier, ou `null` quand le dénominateur est nul. */
function rateOf(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 100);
}

export async function getDashboard(): Promise<Result<DashboardView>> {
  const context = await requireAuthContext();
  if (!context.ok) return context;

  const [monthly, upcoming, reasons, workload, health, statuses, alerts, domainLabels] =
    await Promise.all([
      loadComplianceMonthly(),
      loadUpcomingLoad(),
      loadLateReasons(),
      loadWorkload(),
      loadHealth(),
      loadStatusBreakdown(),
      loadAlerts(),
      loadDomainLabels(),
    ]);

  // Une lecture qui échoue rend un tableau vide plutôt que d'abattre l'écran :
  // un tableau de bord amputé d'un panneau reste utile, un écran d'erreur non.
  const monthlyRows = monthly.ok ? monthly.value : [];
  const upcomingRows = upcoming.ok ? upcoming.value : [];
  const reasonRows = reasons.ok ? reasons.value : [];
  const workloadRows = workload.ok ? workload.value : [];
  const healthRows = health.ok ? health.value : [];
  const statusRows = statuses.ok ? statuses.value : [];
  const labels = domainLabels.ok ? domainLabels.value : new Map<string, string>();

  // ── Douze mois glissants, agrégés tous domaines confondus ─────────────────
  const byMonth = new Map<string, { due: number; onTime: number }>();
  for (const row of monthlyRows) {
    const entry = byMonth.get(row.month) ?? { due: 0, onTime: 0 };
    entry.due += row.dueCount;
    entry.onTime += row.onTimeCount;
    byMonth.set(row.month, entry);
  }
  const monthlySeries = [...byMonth.entries()]
    .map(([month, entry]) => ({
      month,
      due: entry.due,
      onTime: entry.onTime,
      rate: rateOf(entry.onTime, entry.due),
    }))
    .sort((left, right) => left.month.localeCompare(right.month));

  const totalDue = monthlySeries.reduce((sum, entry) => sum + entry.due, 0);
  const totalOnTime = monthlySeries.reduce((sum, entry) => sum + entry.onTime, 0);

  // ── Charge à venir, par semaine ───────────────────────────────────────────
  const byWeek = new Map<string, { total: number; notStarted: number }>();
  for (const row of upcomingRows) {
    const entry = byWeek.get(row.weekStart) ?? { total: 0, notStarted: 0 };
    entry.total += row.total;
    entry.notStarted += row.notStarted;
    byWeek.set(row.weekStart, entry);
  }
  const upcomingSeries = [...byWeek.entries()]
    .map(([weekStart, entry]) => ({
      weekStart,
      started: entry.total - entry.notStarted,
      notStarted: entry.notStarted,
    }))
    .sort((left, right) => left.weekStart.localeCompare(right.weekStart))
    .slice(0, 12);

  // ── Répartition par statut, dossiers OUVERTS seulement ────────────────────
  const byStatus = new Map<string, number>();
  let overdueTotal = 0;
  for (const row of statusRows) {
    byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + row.total);
    overdueTotal += row.overdue;
  }
  const statusSlices = OPEN_STATUSES.map((status) => ({
    status,
    total: byStatus.get(status) ?? 0,
  }));

  // ── Comparaison par domaine ───────────────────────────────────────────────
  const byDomain = new Map<string | null, { open: number; late: number }>();
  for (const row of workloadRows) {
    const entry = byDomain.get(row.domainId) ?? { open: 0, late: 0 };
    entry.open += row.openTotal;
    entry.late += row.lateTotal;
    byDomain.set(row.domainId, entry);
  }
  const domainSeries = [...byDomain.entries()]
    .map(([domainId, entry]) => ({
      domainId,
      label: domainId === null ? "—" : (labels.get(domainId) ?? domainId.slice(0, 8)),
      open: entry.open,
      late: entry.late,
    }))
    .sort((left, right) => right.open - left.open);

  // ── Charge par personne ───────────────────────────────────────────────────
  const byOwner = new Map<string, { open: number; late: number }>();
  for (const row of workloadRows) {
    if (row.ownerId === null) continue;
    const entry = byOwner.get(row.ownerId) ?? { open: 0, late: 0 };
    entry.open += row.openTotal;
    entry.late += row.lateTotal;
    byOwner.set(row.ownerId, entry);
  }
  const ownerLabels = await loadOwnerLabels([...byOwner.keys()]);
  const ownerNames = ownerLabels.ok ? ownerLabels.value : new Map<string, string>();

  const peopleSeries = [...byOwner.entries()]
    .map(([ownerId, entry]) => ({
      ownerId,
      label: ownerNames.get(ownerId) ?? ownerId.slice(0, 8),
      open: entry.open,
      late: entry.late,
    }))
    .sort((left, right) => right.open - left.open)
    .slice(0, 10);

  // ── Santé : validation en attente, complétude ─────────────────────────────
  const pendingValidation = healthRows.reduce((sum, row) => sum + row.pendingValidation, 0);
  const weightedDays = healthRows.reduce(
    (sum, row) => sum + row.pendingAvgDays * row.pendingValidation,
    0,
  );
  const requiredDocs = healthRows.reduce((sum, row) => sum + row.documentsRequired, 0);
  const providedDocs = healthRows.reduce((sum, row) => sum + row.documentsProvided, 0);

  // ── Motifs de retard ──────────────────────────────────────────────────────
  const byReason = new Map<string, number>();
  for (const row of reasonRows) {
    byReason.set(row.code, (byReason.get(row.code) ?? 0) + row.total);
  }

  const dueWithin30 = upcomingSeries
    .filter((week) => {
      const start = Date.parse(`${week.weekStart}T00:00:00Z`);
      return Number.isFinite(start) && start <= Date.now() + 30 * 86_400_000;
    })
    .reduce((sum, week) => sum + week.started + week.notStarted, 0);

  return ok({
    complianceRate: rateOf(totalOnTime, totalDue),
    overdueByCriticality: [{ status: "OVERDUE", total: overdueTotal }],
    dueWithin30Days: dueWithin30,
    pendingValidation,
    // Moyenne PONDÉRÉE par le nombre de dossiers : une moyenne de moyennes
    // donnerait autant de poids à un domaine qui en a deux qu'à un qui en a cent.
    pendingAvgDays:
      pendingValidation === 0 ? 0 : Math.round((weightedDays / pendingValidation) * 10) / 10,
    completenessRate: rateOf(providedDocs, requiredDocs),
    monthly: monthlySeries,
    statuses: statusSlices,
    upcoming: upcomingSeries,
    domains: domainSeries,
    people: peopleSeries,
    lateReasons: [...byReason.entries()]
      .map(([code, total]) => ({ code, total }))
      .sort((left, right) => right.total - left.total),
    alerts: alerts.ok ? [...alerts.value] : [],
  });
}
