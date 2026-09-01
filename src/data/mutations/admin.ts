import "server-only";

/**
 * Écritures de l'administration.
 *
 * ⚠️ Chaque garde sensible vit en BASE, pas ici :
 *   • auto-attribution de rôle       → trigger de 0002 ;
 *   • expiration obligatoire         → `enforce_role_max_duration` (0002) ;
 *   • désactivation sans réaffectation → `deactivate_user` + trigger (0011) ;
 *   • rôle système immuable          → `protect_system_roles` (0011).
 * Ce module les déclenche, il ne les reproduit pas.
 */

import { mapPostgrestError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface NewInvitation {
  readonly email: string;
  readonly fullName: string;
  readonly departmentId: string | null;
  readonly roleId: string;
  readonly domainId: string | null;
  readonly roleExpiresAt: string | null;
  readonly invitedBy: string;
}

export async function insertInvitation(invitation: NewInvitation): Promise<Result<string>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("user_invitations")
    .insert({
      email: invitation.email,
      full_name: invitation.fullName,
      department_id: invitation.departmentId,
      role_id: invitation.roleId,
      domain_id: invitation.domainId,
      role_expires_at: invitation.roleExpiresAt,
      invited_by: invitation.invitedBy,
    })
    .select("id")
    .single();

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data.id);
}

export async function cancelInvitation(invitationId: string): Promise<Result<null>> {
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("user_invitations")
    .update({ cancelled_at: new Date().toISOString() })
    .eq("id", invitationId);

  if (error !== null) return err(mapPostgrestError(error));
  return ok(null);
}

export interface RoleGrant {
  readonly userId: string;
  readonly roleId: string;
  readonly domainId: string | null;
  readonly expiresAt: string | null;
  readonly grantedBy: string;
  readonly reason: string | null;
}

export async function grantRole(grant: RoleGrant): Promise<Result<string>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("user_roles")
    .insert({
      user_id: grant.userId,
      role_id: grant.roleId,
      domain_id: grant.domainId,
      expires_at: grant.expiresAt,
      granted_by: grant.grantedBy,
      grant_reason: grant.reason,
    })
    .select("id")
    .single();

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data.id);
}

export async function revokeRole(assignmentId: string, revokedBy: string): Promise<Result<null>> {
  const supabase = await createSupabaseServerClient();

  // Révocation LOGIQUE : la ligne survit. Qui a eu quel droit, quand et
  // pourquoi, doit rester reconstituable après coup.
  const { error } = await supabase
    .from("user_roles")
    .update({ revoked_at: new Date().toISOString(), revoked_by: revokedBy })
    .eq("id", assignmentId);

  if (error !== null) return err(mapPostgrestError(error));
  return ok(null);
}

export async function deactivateUser(
  userId: string,
  reason: string,
  handoverTo: string | null,
): Promise<Result<number>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("deactivate_user", {
    p_user_id: userId,
    p_reason: reason,
    ...(handoverTo === null ? {} : { p_handover_to: handoverTo }),
  });

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data);
}

export async function resetMfa(userId: string, reason: string): Promise<Result<boolean>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("reset_user_mfa", {
    p_user_id: userId,
    p_reason: reason,
  });

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data);
}

/** Coche ou décoche une case de la matrice. Chaque geste produit un audit. */
export async function setRolePermission(
  roleId: string,
  permissionId: string,
  granted: boolean,
): Promise<Result<null>> {
  const supabase = await createSupabaseServerClient();

  const { error } = granted
    ? await supabase
        .from("role_permissions")
        .insert({ role_id: roleId, permission_id: permissionId })
    : await supabase
        .from("role_permissions")
        .delete()
        .eq("role_id", roleId)
        .eq("permission_id", permissionId);

  if (error !== null) return err(mapPostgrestError(error));
  return ok(null);
}

export interface HolidayInput {
  readonly date: string;
  readonly label: string;
  readonly isRecurring: boolean;
  readonly source: string | null;
}

export async function upsertHolidays(rows: readonly HolidayInput[]): Promise<Result<number>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("holidays")
    .upsert(
      rows.map((row) => ({
        holiday_date: row.date,
        label: row.label,
        is_recurring: row.isRecurring,
        source: row.source,
      })),
      { onConflict: "holiday_date" },
    )
    .select("id");

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data.length);
}

export async function deleteHoliday(holidayId: string): Promise<Result<null>> {
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.from("holidays").delete().eq("id", holidayId);
  if (error !== null) return err(mapPostgrestError(error));
  return ok(null);
}

/** Applique des échéances recalculées et prévient les responsables. */
export async function applyDueDateUpdates(
  updates: readonly { occurrence_id: string; legal_due_date: string; internal_due_date: string }[],
  reason: string,
): Promise<Result<number>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("apply_due_date_updates", {
    p_updates: [...updates],
    p_reason: reason,
  });

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data);
}

export async function updateSetting(key: string, value: unknown): Promise<Result<null>> {
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("app_settings")
    .update({ value: value as never, updated_at: new Date().toISOString() })
    .eq("key", key);

  if (error !== null) return err(mapPostgrestError(error));
  return ok(null);
}

export async function logAuditExport(
  filters: Record<string, unknown>,
  rowCount: number,
): Promise<Result<null>> {
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.rpc("log_audit_export", {
    p_filters: filters as never,
    p_row_count: rowCount,
  });

  if (error !== null) return err(mapPostgrestError(error));
  return ok(null);
}
