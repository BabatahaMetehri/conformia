import "server-only";

/**
 * Lectures de l'administration.
 *
 * Toutes passent par la RLS : la politique de `profiles`, de `user_roles` et de
 * `audit_log` décide de ce qui remonte. Aucun filtre d'habilitation n'est
 * réécrit ici.
 */

import { mapPostgrestError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// ─── Comptes ─────────────────────────────────────────────────────────────────

export interface UserRoleAssignment {
  readonly id: string;
  readonly roleCode: string;
  readonly roleLabel: string;
  readonly domainLabel: string | null;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
}

export interface UserRow {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
  readonly departmentName: string | null;
  readonly mfaEnrolled: boolean;
  readonly lastLoginAt: string | null;
  readonly deactivatedAt: string | null;
  readonly roles: readonly UserRoleAssignment[];
  readonly openTasks: number;
}

export async function listUsers(): Promise<Result<readonly UserRow[]>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("profiles")
    .select(
      // ⚠️ `user_roles` pointe TROIS fois vers `profiles` (titulaire, attributeur,
      // révocateur) : sans nommer la contrainte, PostgREST ne sait pas laquelle
      // suivre et refuse la jointure.
      "id, full_name, email, mfa_enrolled, last_login_at, deactivated_at, departments(name), user_roles!user_roles_user_id_fkey(id, expires_at, revoked_at, roles(code, label), domains(label))",
    )
    .order("full_name");

  if (error !== null) return err(mapPostgrestError(error));

  // La charge ouverte de chaque compte : c'est elle qui conditionne la
  // désactivation, et l'écran doit la montrer AVANT qu'on tente le geste.
  const counts = await Promise.all(
    data.map(async (row) => {
      const { data: count } = await supabase.rpc("open_task_count", { p_user_id: row.id });
      return [row.id, count ?? 0] as const;
    }),
  );
  const openByUser = new Map(counts);

  return ok(
    data.map((row) => ({
      id: row.id,
      fullName: row.full_name ?? row.email ?? row.id.slice(0, 8),
      email: row.email ?? "",
      departmentName: row.departments?.name ?? null,
      mfaEnrolled: row.mfa_enrolled,
      lastLoginAt: row.last_login_at,
      deactivatedAt: row.deactivated_at,
      openTasks: openByUser.get(row.id) ?? 0,
      roles: row.user_roles
        .filter((assignment) => assignment.revoked_at === null)
        .map((assignment) => ({
          id: assignment.id,
          roleCode: assignment.roles.code,
          roleLabel: assignment.roles.label,
          domainLabel: assignment.domains?.label ?? null,
          expiresAt: assignment.expires_at,
          revokedAt: assignment.revoked_at,
        })),
    })),
  );
}

export interface InvitationRow {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly roleLabel: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly dispatchedAt: string | null;
  readonly acceptedAt: string | null;
  readonly cancelledAt: string | null;
}

export async function listInvitations(): Promise<Result<readonly InvitationRow[]>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("user_invitations")
    .select(
      "id, email, full_name, created_at, expires_at, dispatched_at, accepted_at, cancelled_at, roles(label)",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      roleLabel: row.roles.label,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      dispatchedAt: row.dispatched_at,
      acceptedAt: row.accepted_at,
      cancelledAt: row.cancelled_at,
    })),
  );
}

// ─── Matrice des rôles ───────────────────────────────────────────────────────

export interface RoleRow {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly isSystem: boolean;
  readonly maxDurationDays: number | null;
  readonly holders: number;
}

export interface PermissionRow {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly category: string;
}

export interface RoleMatrix {
  readonly roles: readonly RoleRow[];
  readonly permissions: readonly PermissionRow[];
  /** Clés `${roleId}:${permissionId}` présentes dans la matrice. */
  readonly granted: ReadonlySet<string>;
}

export async function loadRoleMatrix(): Promise<Result<RoleMatrix>> {
  const supabase = await createSupabaseServerClient();

  const [roles, permissions, links] = await Promise.all([
    supabase.from("roles").select("id, code, label, is_system, max_duration_days").order("code"),
    supabase
      .from("permissions")
      .select("id, code, label, category")
      .order("category")
      .order("code"),
    supabase.from("role_permissions").select("role_id, permission_id"),
  ]);

  if (roles.error !== null) return err(mapPostgrestError(roles.error));
  if (permissions.error !== null) return err(mapPostgrestError(permissions.error));
  if (links.error !== null) return err(mapPostgrestError(links.error));

  const holders = await Promise.all(
    roles.data.map(async (role) => {
      const { data } = await supabase.rpc("role_holder_count", { p_role_id: role.id });
      return [role.id, data ?? 0] as const;
    }),
  );
  const holderByRole = new Map(holders);

  return ok({
    roles: roles.data.map((role) => ({
      id: role.id,
      code: role.code,
      label: role.label,
      isSystem: role.is_system,
      maxDurationDays: role.max_duration_days,
      holders: holderByRole.get(role.id) ?? 0,
    })),
    permissions: permissions.data.map((permission) => ({
      id: permission.id,
      code: permission.code,
      label: permission.label,
      category: permission.category,
    })),
    granted: new Set(links.data.map((link) => `${link.role_id}:${link.permission_id}`)),
  });
}

// ─── Référentiels ────────────────────────────────────────────────────────────

export interface HolidayRow {
  readonly id: string;
  readonly date: string;
  readonly label: string;
  readonly isRecurring: boolean;
  readonly source: string | null;
}

export async function listHolidays(fromYear: number): Promise<Result<readonly HolidayRow[]>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("holidays")
    .select("id, holiday_date, label, is_recurring, source")
    .gte("holiday_date", `${String(fromYear)}-01-01`)
    .order("holiday_date");

  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      id: row.id,
      date: row.holiday_date,
      label: row.label,
      isRecurring: row.is_recurring,
      source: row.source,
    })),
  );
}

export interface ReferentialRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface Referentials {
  readonly authorities: readonly ReferentialRow[];
  readonly domains: readonly ReferentialRow[];
  readonly departments: readonly ReferentialRow[];
}

export async function loadReferentials(): Promise<Result<Referentials>> {
  const supabase = await createSupabaseServerClient();

  const [authorities, domains, departments] = await Promise.all([
    supabase.from("authorities").select("id, code, name").order("name"),
    supabase.from("domains").select("id, code, label").order("label"),
    supabase.from("departments").select("id, code, name").order("name"),
  ]);

  if (authorities.error !== null) return err(mapPostgrestError(authorities.error));
  if (domains.error !== null) return err(mapPostgrestError(domains.error));
  if (departments.error !== null) return err(mapPostgrestError(departments.error));

  return ok({
    authorities: authorities.data.map((row) => ({ id: row.id, code: row.code, name: row.name })),
    domains: domains.data.map((row) => ({ id: row.id, code: row.code, name: row.label })),
    departments: departments.data.map((row) => ({ id: row.id, code: row.code, name: row.name })),
  });
}

// ─── Réglages ────────────────────────────────────────────────────────────────

export interface SettingRow {
  readonly key: string;
  readonly value: unknown;
  readonly description: string;
  readonly valueType: string;
  readonly updatedAt: string;
}

export async function listSettings(): Promise<Result<readonly SettingRow[]>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("app_settings")
    .select("key, value, description, value_type, updated_at")
    .order("key");

  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      key: row.key,
      value: row.value,
      description: row.description,
      valueType: row.value_type,
      updatedAt: row.updated_at,
    })),
  );
}

// ─── Journal d'audit ─────────────────────────────────────────────────────────

export interface AuditFilters {
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly actorId?: string | undefined;
  readonly action?: string | undefined;
  readonly entityTable?: string | undefined;
  readonly ipAddress?: string | undefined;
  readonly limit: number;
  readonly offset: number;
}

export interface AuditEntryRow {
  readonly id: number;
  readonly occurredAt: string;
  readonly actorEmail: string | null;
  readonly onBehalfOfId: string | null;
  readonly action: string;
  readonly entityTable: string;
  readonly entityIdRef: string | null;
  readonly changedFields: readonly string[];
  readonly before: unknown;
  readonly after: unknown;
  readonly ipAddress: string | null;
}

export interface AuditPage {
  readonly rows: readonly AuditEntryRow[];
  readonly total: number;
}

/**
 * Journal paginé.
 *
 * ⚠️ La borne de PÉRIODE est ce qui rend la table tenable sur plusieurs millions
 * de lignes : `audit_log` est partitionnée par mois, et un filtre sur
 * `occurred_at` laisse PostgreSQL écarter les partitions hors plage sans les
 * lire. Sans borne, la requête balaie tout l'historique — d'où une fenêtre par
 * défaut, jamais « tout ».
 */
export async function searchAuditLog(filters: AuditFilters): Promise<Result<AuditPage>> {
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("audit_log")
    .select(
      "id, occurred_at, actor_email, on_behalf_of_id, action, entity_table, entity_id_ref, changed_fields, before, after, ip_address",
      { count: "estimated" },
    )
    .order("occurred_at", { ascending: false })
    .range(filters.offset, filters.offset + filters.limit - 1);

  if (filters.from !== undefined) query = query.gte("occurred_at", filters.from);
  if (filters.to !== undefined) query = query.lte("occurred_at", filters.to);
  if (filters.actorId !== undefined) query = query.eq("actor_id", filters.actorId);
  if (filters.action !== undefined) query = query.eq("action", filters.action);
  if (filters.entityTable !== undefined) query = query.eq("entity_table", filters.entityTable);
  if (filters.ipAddress !== undefined) query = query.eq("ip_address", filters.ipAddress);

  const { data, error, count } = await query;
  if (error !== null) return err(mapPostgrestError(error));

  return ok({
    total: count ?? 0,
    rows: data.map((row) => ({
      id: row.id,
      occurredAt: row.occurred_at,
      actorEmail: row.actor_email,
      onBehalfOfId: row.on_behalf_of_id,
      action: row.action,
      entityTable: row.entity_table,
      entityIdRef: row.entity_id_ref,
      changedFields: row.changed_fields ?? [],
      before: row.before,
      after: row.after,
      // `inet` n'a pas d'équivalent TypeScript : PostgREST le rend en texte,
      // le type généré le déclare `unknown`.
      ipAddress: typeof row.ip_address === "string" ? row.ip_address : null,
    })),
  });
}

// ─── Recalcul d'échéances ────────────────────────────────────────────────────

export interface PendingOccurrenceRow {
  readonly id: string;
  readonly periodKey: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly expiryDate: string | null;
  readonly eventDate: string | null;
  readonly legalDueDate: string;
  readonly internalDueDate: string;
  readonly rule: unknown;
  readonly leadDays: number;
  readonly periodicity: string;
}

/**
 * Occurrences dont une modification du calendrier peut déplacer l'échéance.
 *
 * ⚠️ `TODO` et non verrouillées, EXCLUSIVEMENT : on ne déplace pas le sol sous
 * les pieds de quelqu'un qui a déjà commencé. La même borne est réappliquée par
 * `apply_due_date_updates`, qui refuse tout le reste.
 */
export async function listRecalculableOccurrences(
  fromDate: string,
): Promise<Result<readonly PendingOccurrenceRow[]>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("obligation_occurrences")
    .select(
      "id, period_key, period_start, period_end, expiry_date, event_date, legal_due_date, internal_due_date, obligation_types!inner(due_rule, internal_lead_days, periodicity)",
    )
    .eq("status", "TODO")
    .eq("is_locked", false)
    .is("deleted_at", null)
    .gte("period_end", fromDate);

  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      id: row.id,
      periodKey: row.period_key,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      expiryDate: row.expiry_date,
      eventDate: row.event_date,
      legalDueDate: row.legal_due_date,
      internalDueDate: row.internal_due_date,
      rule: row.obligation_types.due_rule,
      leadDays: row.obligation_types.internal_lead_days,
      periodicity: row.obligation_types.periodicity,
    })),
  );
}

/** Toutes les dates chômées, sans borne : le calcul d'échéance les veut toutes. */
export async function listHolidayDates(): Promise<Result<readonly string[]>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.from("holidays").select("holiday_date");
  if (error !== null) return err(mapPostgrestError(error));

  return ok(data.map((row) => row.holiday_date));
}
