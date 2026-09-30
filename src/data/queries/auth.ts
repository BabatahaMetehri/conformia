import "server-only";

/**
 * Lectures d'identité et d'habilitation.
 *
 * Alimente `getAuthContext()`. Les permissions rendues ici servent à décider tôt
 * (défense en profondeur) ; l'autorité reste la RLS.
 */

import { AppError, mapPostgrestError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DomainId, ProfileId } from "@/types/domain";

/** Chaîne littérale unique : supabase-js type le résultat depuis cette valeur. */
const PROFILE_COLUMNS =
  "id, entity_id, department_id, full_name, email, phone, job_title, is_active, mfa_enrolled, last_login_at, created_at, updated_at, deleted_at";

export interface AuthenticatedUser {
  readonly id: ProfileId;
  readonly email: string | null;
}

export interface PasswordRecoveryState {
  readonly active: boolean;
  readonly requiresMfa: boolean;
}

/**
 * Détecte une session de récupération déjà établie, notamment après un
 * rafraîchissement de /reset-password quand le code à usage unique a déjà
 * été consommé.
 */
export async function getPasswordRecoveryState(): Promise<Result<PasswordRecoveryState>> {
  const supabase = await createSupabaseServerClient();

  const { error: userError } = await supabase.auth.getUser();

  if (userError !== null) {
    return ok({
      active: false,
      requiresMfa: false,
    });
  }

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();

  if (claimsError !== null) {
    return err(AppError.internal({ cause: claimsError }));
  }

  const amr = claimsData?.claims.amr;

  const isRecoverySession =
    Array.isArray(amr) &&
    amr.some(
      (method) => typeof method === "object" && "method" in method && method.method === "recovery",
    );

  if (!isRecoverySession) {
    return ok({
      active: false,
      requiresMfa: false,
    });
  }

  const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (aalError !== null) {
    return err(AppError.internal({ cause: aalError }));
  }

  return ok({
    active: true,
    requiresMfa: aal.nextLevel === "aal2" && aal.currentLevel !== "aal2",
  });
}

export interface ProfileSummary {
  readonly id: ProfileId;
  readonly fullName: string | null;
  readonly email: string | null;
  readonly departmentId: string | null;
  readonly jobTitle: string | null;
  readonly phone: string | null;
  readonly isActive: boolean;
  readonly mfaEnrolled: boolean;
}

export interface RoleGrant {
  readonly roleCode: string;
  readonly domainId: DomainId | null;
  readonly expiresAt: string | null;
}

export interface ActiveDelegation {
  readonly delegatorId: ProfileId;
  readonly domainId: DomainId | null;
  readonly startsAt: string;
  readonly endsAt: string;
}

/** Session courante. `null` sur les écrans du groupe (auth) : ce n'est pas une erreur. */
export async function getAuthenticatedUser(): Promise<Result<AuthenticatedUser | null>> {
  const supabase = await createSupabaseServerClient();

  // `getUser()` revalide le jeton auprès du serveur d'authentification ;
  // `getSession()` se contenterait de lire un cookie potentiellement forgé.
  const { data, error } = await supabase.auth.getUser();
  if (error !== null) return ok(null);

  return ok({
    id: data.user.id as ProfileId,
    email: data.user.email ?? null,
  });
}

export async function getProfile(userId: ProfileId): Promise<Result<ProfileSummary | null>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error !== null) return err(mapPostgrestError(error));
  if (data === null) return ok(null);

  return ok({
    id: data.id as ProfileId,
    fullName: data.full_name,
    email: data.email,
    departmentId: data.department_id,
    jobTitle: data.job_title,
    phone: data.phone,
    isActive: data.is_active,
    mfaEnrolled: data.mfa_enrolled,
  });
}

/** Attributions actives : ni révoquées, ni expirées. */
export async function getActiveRoleGrants(
  userId: ProfileId,
): Promise<Result<readonly RoleGrant[]>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("user_roles")
    .select("domain_id, expires_at, roles!inner(code)")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);

  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      roleCode: row.roles.code,
      domainId: row.domain_id as DomainId | null,
      expiresAt: row.expires_at,
    })),
  );
}

/**
 * Permissions effectives, dédupliquées. Résolues en base plutôt que reconstituées
 * en TypeScript : la matrice rôle → permissions est une donnée, pas du code.
 */
export async function getEffectivePermissions(
  userId: ProfileId,
): Promise<Result<readonly string[]>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("user_roles")
    .select("role_permissions:roles!inner(role_permissions(permissions(code)))")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);

  if (error !== null) return err(mapPostgrestError(error));

  const codes = new Set<string>();
  for (const grant of data) {
    for (const link of grant.role_permissions.role_permissions) {
      codes.add(link.permissions.code);
    }
  }
  return ok([...codes]);
}

export async function getActiveDelegations(
  userId: ProfileId,
): Promise<Result<readonly ActiveDelegation[]>> {
  const supabase = await createSupabaseServerClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("validation_delegations")
    .select("delegator_id, domain_id, starts_at, ends_at")
    .eq("delegate_id", userId)
    .is("revoked_at", null)
    .lte("starts_at", today)
    .gte("ends_at", today);

  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      delegatorId: row.delegator_id as ProfileId,
      domainId: row.domain_id as DomainId | null,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
    })),
  );
}

/** Second facteur réellement enrôlé — lit auth.mfa_factors, pas le reflet applicatif. */
export async function hasVerifiedMfa(userId: ProfileId): Promise<Result<boolean>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("has_verified_mfa", { p_user_id: userId });
  if (error !== null) return err(mapPostgrestError(error));
  return ok(data);
}

/** Le second facteur est-il exigé pour ce compte (ADMIN, DIRECTION, ou réglage global) ? */
export async function isMfaRequiredFor(userId: ProfileId): Promise<Result<boolean>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("mfa_required_for", { p_user_id: userId });
  if (error !== null) return err(mapPostgrestError(error));
  return ok(data);
}
