import "server-only";

/**
 * Contexte d'autorisation de la requête courante.
 *
 * DÉFENSE EN PROFONDEUR. Ces vérifications ne remplacent pas la RLS : elles la
 * précèdent. La RLS est le dernier rempart, pas le premier — elle refuse une
 * ligne, mais elle ne sait pas dire pourquoi, ni éviter un travail inutile, ni
 * produire un message intelligible. Chaque Server Action commence donc par un
 * `require*`, et la base refuse quand même si le contrôle a été oublié.
 *
 * `cache` mémorise par requête : un écran qui vérifie cinq permissions ne
 * déclenche qu'une seule résolution d'identité.
 */

import { cache } from "react";

import { isRoleCode } from "@/config/permissions";
import type { Permission, RoleCode } from "@/config/permissions";
import {
  getActiveDelegations,
  getActiveRoleGrants,
  getAuthenticatedUser,
  getEffectivePermissions,
  getProfile,
  hasVerifiedMfa,
  isMfaRequiredFor,
  type ActiveDelegation,
  type ProfileSummary,
  type RoleGrant,
} from "@/data/queries/auth";
import { AppError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import type { DomainId, ProfileId } from "@/types/domain";

export interface MfaState {
  /** Exigé pour ADMIN et DIRECTION, ou globalement via require_mfa_all_users. */
  readonly required: boolean;
  readonly enrolled: boolean;
}

export interface AuthContext {
  readonly userId: ProfileId;
  readonly email: string | null;
  readonly profile: ProfileSummary;
  readonly roles: readonly RoleCode[];
  readonly grants: readonly RoleGrant[];
  readonly permissions: ReadonlySet<Permission>;
  /** Domaines accessibles. `null` signifie « portée globale », donc tous. */
  readonly domains: ReadonlySet<DomainId> | null;
  readonly delegations: readonly ActiveDelegation[];
  readonly mfa: MfaState;
}

/**
 * Contexte de la requête, ou `null` si aucune session — ce n'est pas une erreur :
 * les écrans du groupe (auth) se rendent précisément sans utilisateur.
 *
 * Un compte désactivé rend également `null` : la désactivation prime sur
 * l'habilitation, sans qu'aucun appelant ait à y penser.
 */
export const getAuthContext = cache(async (): Promise<Result<AuthContext | null>> => {
  const user = await getAuthenticatedUser();
  if (!user.ok) return user;
  if (user.value === null) return ok(null);

  const profile = await getProfile(user.value.id);
  if (!profile.ok) return profile;
  if (profile.value === null || !profile.value.isActive) return ok(null);

  const [grants, permissions, delegations, enrolled, required] = await Promise.all([
    getActiveRoleGrants(user.value.id),
    getEffectivePermissions(user.value.id),
    getActiveDelegations(user.value.id),
    hasVerifiedMfa(user.value.id),
    isMfaRequiredFor(user.value.id),
  ]);

  if (!grants.ok) return grants;
  if (!permissions.ok) return permissions;
  if (!delegations.ok) return delegations;
  if (!enrolled.ok) return enrolled;
  if (!required.ok) return required;

  // Une seule attribution de portée globale suffit à ouvrir tous les domaines.
  const hasGlobalScope = grants.value.some((grant) => grant.domainId === null);
  const domains = hasGlobalScope
    ? null
    : new Set(
        grants.value
          .map((grant) => grant.domainId)
          .filter((domainId): domainId is DomainId => domainId !== null),
      );

  return ok({
    userId: user.value.id,
    email: user.value.email,
    profile: profile.value,
    roles: grants.value.map((grant) => grant.roleCode).filter(isRoleCode),
    grants: grants.value,
    permissions: new Set(permissions.value as readonly Permission[]),
    domains,
    delegations: delegations.value,
    mfa: { required: required.value, enrolled: enrolled.value },
  });
});

/** Contexte, ou UNAUTHENTICATED. Point d'entrée des actions qui exigent une session. */
export async function requireAuthContext(): Promise<Result<AuthContext>> {
  const context = await getAuthContext();
  if (!context.ok) return context;
  if (context.value === null) return err(AppError.unauthenticated());
  return ok(context.value);
}

export async function requirePermission(permission: Permission): Promise<Result<AuthContext>> {
  const context = await requireAuthContext();
  if (!context.ok) return context;

  if (!context.value.permissions.has(permission)) {
    return err(AppError.forbidden({ details: { permission } }));
  }
  return ok(context.value);
}

/** Une seule des permissions demandées suffit. */
export async function requireAnyPermission(
  permissions: readonly Permission[],
): Promise<Result<AuthContext>> {
  const context = await requireAuthContext();
  if (!context.ok) return context;

  const granted = permissions.some((permission) => context.value.permissions.has(permission));
  if (!granted) {
    return err(AppError.forbidden({ details: { anyOf: [...permissions] } }));
  }
  return ok(context.value);
}

/** Vérifie l'accès à un domaine ; une portée globale satisfait toute demande. */
export async function requireDomainAccess(domainId: DomainId): Promise<Result<AuthContext>> {
  const context = await requireAuthContext();
  if (!context.ok) return context;

  const { domains } = context.value;
  if (domains !== null && !domains.has(domainId)) {
    return err(AppError.forbidden({ details: { domainId } }));
  }
  return ok(context.value);
}

/** Combine permission et domaine — le contrôle le plus courant du métier. */
export async function requirePermissionInDomain(
  permission: Permission,
  domainId: DomainId,
): Promise<Result<AuthContext>> {
  const withPermission = await requirePermission(permission);
  if (!withPermission.ok) return withPermission;

  const { domains } = withPermission.value;
  if (domains !== null && !domains.has(domainId)) {
    return err(AppError.forbidden({ details: { permission, domainId } }));
  }
  return ok(withPermission.value);
}
