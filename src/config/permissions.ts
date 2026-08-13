/**
 * Vocabulaire d'autorisation : rôles et permissions.
 *
 * Ce module ne déclare que le VOCABULAIRE. L'association rôle → permissions est
 * une donnée, portée par la base (cf. CLAUDE.md §3.5) : une organisation qui
 * change ses délégations ne doit pas exiger un déploiement.
 *
 * L'autorité reste la RLS Postgres. Ce qui est vérifié ici sert à masquer ou
 * désactiver l'interface ; toute vérification doit avoir son équivalent en policy.
 * Une permission accordée par erreur ici expose un bouton, pas une donnée.
 */

// ─── Permissions ─────────────────────────────────────────────────────────────

export const PERMISSIONS = [
  // Référentiel
  "obligation.read",
  "referential.manage",

  // Occurrences
  "occurrence.read",
  "occurrence.write",
  "occurrence.assign",
  "occurrence.submit",
  "occurrence.validate",
  "occurrence.mark_na",
  /** Rouvrir une occurrence verrouillée ou une période clôturée. */
  "occurrence.unlock",

  // Documents
  "document.read",
  "document.upload",
  "document.delete",

  // Administration
  "audit.read",
  "user.manage",
  "role.manage",
  "settings.manage",

  // Transverse
  /** Voir le tableau de bord de tous les départements, pas seulement le sien. */
  "dashboard.view_all",
  "export.generate",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

// ─── Rôles ───────────────────────────────────────────────────────────────────

export const ROLE_CODES = [
  "ADMIN",
  "DIRECTION",
  "COMPTA_MANAGER",
  "COMPTA_AGENT",
  "RH_MANAGER",
  "RH_AGENT",
  "REGLEMENTAIRE",
  "AUDITOR",
  /** Intervenant externe (cabinet comptable, conseil) : accès strictement borné. */
  "EXTERNAL",
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

// ─── Garde-fous de comptage ──────────────────────────────────────────────────

type AssertLength<
  TTuple extends { length: number },
  TExpected extends number,
> = TTuple["length"] extends TExpected ? true : never;

/** Casse la compilation si le nombre de permissions dérive des 18 arrêtées. */
export type PermissionCountIs18 = AssertLength<typeof PERMISSIONS, 18>;
/** Casse la compilation si le nombre de rôles dérive des 9 arrêtés. */
export type RoleCountIs9 = AssertLength<typeof ROLE_CODES, 9>;

// ─── Vérification ────────────────────────────────────────────────────────────

/**
 * Teste une permission contre l'ensemble effectivement accordé à l'utilisateur,
 * tel que chargé depuis la base. Aucune table rôle → permissions n'est figée
 * dans le code : elle serait une seconde source de vérité, condamnée à diverger
 * de la RLS.
 */
export function hasPermission(granted: Iterable<Permission>, permission: Permission): boolean {
  for (const candidate of granted) {
    if (candidate === permission) return true;
  }
  return false;
}

/** Vrai si toutes les permissions demandées sont accordées. */
export function hasAllPermissions(
  granted: Iterable<Permission>,
  required: Iterable<Permission>,
): boolean {
  const set = new Set(granted);
  for (const permission of required) {
    if (!set.has(permission)) return false;
  }
  return true;
}

export function isPermission(value: string): value is Permission {
  return PERMISSIONS.some((permission) => permission === value);
}

export function isRoleCode(value: string): value is RoleCode {
  return ROLE_CODES.some((role) => role === value);
}
