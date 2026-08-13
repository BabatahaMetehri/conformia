"use client";

/**
 * Utilisateur connecté, ses rôles et ses permissions.
 *
 * ⚠️ Ce hook ne déclenche AUCUN appel réseau. La valeur est calculée une fois
 * par le Server Component racine et descendue par contexte. C'est délibéré :
 * l'identité et les droits sont nécessaires au premier rendu de presque chaque
 * écran ; les charger côté client produirait un éclair d'interface sans droits,
 * puis un recalcul, sur chaque navigation.
 *
 * Les permissions rendues ici servent à MASQUER l'interface. Elles n'autorisent
 * rien : l'autorité est la RLS Postgres (cf. CLAUDE.md §1).
 */

import { createContext, useContext, useMemo } from "react";

import { hasAllPermissions, hasPermission } from "@/config/permissions";
import type { Permission, RoleCode } from "@/config/permissions";
import type { CurrentUser } from "@/types/current-user";

export type { CurrentUser, CurrentUserProfile } from "@/types/current-user";

export const CurrentUserContext = createContext<CurrentUser | null>(null);

/** `null` si la session est absente — cas des pages du groupe (auth). */
export function useCurrentUser(): CurrentUser | null {
  return useContext(CurrentUserContext);
}

/**
 * Variante pour les écrans de la zone authentifiée, où l'absence d'utilisateur
 * est un bug de câblage et non un état à gérer dans le rendu.
 */
export function useRequiredCurrentUser(): CurrentUser {
  const user = useContext(CurrentUserContext);
  if (user === null) {
    throw new Error(
      "useRequiredCurrentUser() hors session : ce composant doit être rendu sous la zone authentifiée.",
    );
  }
  return user;
}

export interface AccessChecks {
  can(permission: Permission): boolean;
  canAll(permissions: Iterable<Permission>): boolean;
  hasRole(role: RoleCode): boolean;
}

/** Tests de droits pour conditionner l'affichage d'une action. */
export function useAccess(): AccessChecks {
  const user = useCurrentUser();

  return useMemo<AccessChecks>(
    () => ({
      can: (permission) => user !== null && hasPermission(user.permissions, permission),
      canAll: (permissions) => user !== null && hasAllPermissions(user.permissions, permissions),
      hasRole: (role) => user !== null && user.roles.includes(role),
    }),
    [user],
  );
}
