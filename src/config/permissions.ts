/**
 * Rôles et permissions applicatifs.
 *
 * Ceci est le miroir côté application des rôles portés par la base. L'autorité
 * reste la RLS Postgres : cette table sert à masquer/désactiver l'UI, jamais à
 * garantir un accès. Toute vérification ici doit avoir son équivalent en policy.
 *
 * Ne contient aucune règle réglementaire (périodicité, échéance, pièces) :
 * celles-ci sont des données (cf. CLAUDE.md §3.5).
 */

export const ROLES = ["admin", "manager", "contributor", "validator", "auditor"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "obligation:read",
  "obligation:write",
  "occurrence:read",
  "occurrence:write",
  "occurrence:validate",
  "occurrence:submit",
  "document:read",
  "document:upload",
  "audit:read",
  "admin:manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  admin: PERMISSIONS,
  manager: [
    "obligation:read",
    "obligation:write",
    "occurrence:read",
    "occurrence:write",
    "occurrence:validate",
    "occurrence:submit",
    "document:read",
    "document:upload",
    "audit:read",
  ],
  validator: [
    "obligation:read",
    "occurrence:read",
    "occurrence:validate",
    "document:read",
    "audit:read",
  ],
  contributor: [
    "obligation:read",
    "occurrence:read",
    "occurrence:write",
    "document:read",
    "document:upload",
  ],
  auditor: ["obligation:read", "occurrence:read", "document:read", "audit:read"],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
