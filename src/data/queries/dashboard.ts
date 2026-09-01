import "server-only";

/**
 * Lectures du tableau de bord.
 *
 * ⚠️ TOUS les agrégats viennent de vues matérialisées, rafraîchies toutes les
 * quinze minutes par pg_cron. Aucun calcul lourd n'est fait à la demande, et
 * aucune de ces fonctions ne touche `obligation_occurrences` directement.
 *
 * ⚠️ Les vues elles-mêmes ne sont accessibles à PERSONNE : PostgreSQL n'applique
 * pas la RLS aux vues matérialisées. Le seul accès passe par les fonctions
 * `*_for_caller()`, qui réappliquent le cloisonnement par domaine. Contourner
 * cette couche reviendrait à publier la charge de travail de services qu'on n'a
 * pas le droit de voir.
 *
 * Le bandeau d'alertes fait exception, et c'est délibéré : il interroge les
 * tables vives, parce qu'une alerte différée d'un quart d'heure n'est pas une
 * alerte.
 */

import { mapPostgrestError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface ComplianceMonthRow {
  readonly domainId: string | null;
  readonly month: string;
  readonly dueCount: number;
  readonly onTimeCount: number;
}

export async function loadComplianceMonthly(): Promise<Result<readonly ComplianceMonthRow[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("dashboard_compliance_for_caller");
  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      domainId: row.domain_id,
      month: row.month,
      dueCount: row.due_count,
      onTimeCount: row.on_time_count,
    })),
  );
}

export interface UpcomingWeekRow {
  readonly domainId: string | null;
  readonly weekStart: string;
  readonly total: number;
  readonly notStarted: number;
}

export async function loadUpcomingLoad(): Promise<Result<readonly UpcomingWeekRow[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("dashboard_upcoming_for_caller");
  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      domainId: row.domain_id,
      weekStart: row.week_start,
      total: row.total,
      notStarted: row.not_started,
    })),
  );
}

export interface LateReasonRow {
  readonly domainId: string | null;
  readonly code: string;
  readonly total: number;
}

export async function loadLateReasons(): Promise<Result<readonly LateReasonRow[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("dashboard_late_reasons_for_caller");
  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      domainId: row.domain_id,
      code: row.late_reason_code,
      total: row.total,
    })),
  );
}

export interface WorkloadRow {
  readonly domainId: string | null;
  readonly departmentId: string | null;
  readonly ownerId: string | null;
  readonly openTotal: number;
  readonly lateTotal: number;
}

export async function loadWorkload(): Promise<Result<readonly WorkloadRow[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("dashboard_workload_for_caller");
  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      domainId: row.domain_id,
      departmentId: row.department_id,
      ownerId: row.owner_id,
      openTotal: row.open_total,
      lateTotal: row.late_total,
    })),
  );
}

export interface HealthRow {
  readonly domainId: string | null;
  readonly pendingValidation: number;
  readonly pendingAvgDays: number;
  readonly documentsRequired: number;
  readonly documentsProvided: number;
}

export async function loadHealth(): Promise<Result<readonly HealthRow[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("dashboard_health_for_caller");
  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      domainId: row.domain_id,
      pendingValidation: row.pending_validation,
      pendingAvgDays: row.pending_avg_days,
      documentsRequired: row.documents_required,
      documentsProvided: row.documents_provided,
    })),
  );
}

export interface StatusBreakdownRow {
  readonly domainId: string | null;
  readonly status: string;
  readonly total: number;
  readonly overdue: number;
}

/** Répartition par statut : la matview de 0007, réemployée telle quelle. */
export async function loadStatusBreakdown(): Promise<Result<readonly StatusBreakdownRow[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("occurrence_stats_for_caller");
  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      domainId: row.domain_id,
      status: row.status,
      total: row.total,
      overdue: row.overdue,
    })),
  );
}

export interface AlertRow {
  readonly code: string;
  readonly severity: string;
  readonly total: number;
}

export async function loadAlerts(): Promise<Result<readonly AlertRow[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("dashboard_alerts");
  if (error !== null) return err(mapPostgrestError(error));

  return ok(data.map((row) => ({ code: row.code, severity: row.severity, total: row.total })));
}

/** Libellés des domaines, pour nommer les séries sans les deviner. */
export async function loadDomainLabels(): Promise<Result<ReadonlyMap<string, string>>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("domains").select("id, code, label");
  if (error !== null) return err(mapPostgrestError(error));

  return ok(new Map(data.map((row) => [row.id, row.label])));
}

/** Noms des personnes portant de la charge — la charge sans le nom ne sert à rien. */
export async function loadOwnerLabels(
  ids: readonly string[],
): Promise<Result<ReadonlyMap<string, string>>> {
  if (ids.length === 0) return ok(new Map());

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, department_id, departments(name)")
    .in("id", [...ids]);

  if (error !== null) return err(mapPostgrestError(error));
  // `full_name` est nullable : on retombe sur un fragment d'identifiant plutôt
  // que d'afficher « null » dans un graphique de charge.
  return ok(new Map(data.map((row) => [row.id, row.full_name ?? row.id.slice(0, 8)])));
}
