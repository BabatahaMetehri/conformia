/**
 * Projection de l'utilisateur connecté, telle qu'elle traverse le rendu.
 *
 * Déclarée ici, et non dans le hook client, pour que la couche services puisse
 * la produire sans dépendre de React (cf. CLAUDE.md §3.1).
 */

import type { Locale } from "@/config/constants";
import type { Permission, RoleCode } from "@/config/permissions";

export interface CurrentUserProfile {
  readonly fullName: string | null;
  readonly departmentId: string | null;
  readonly locale: Locale;
}

export interface CurrentUser {
  readonly id: string;
  /** `null` pour un compte sans adresse (jamais dans le flux nominal). */
  readonly email: string | null;
  /** `null` tant que le profil applicatif n'a pas été créé pour ce compte. */
  readonly profile: CurrentUserProfile | null;
  readonly roles: readonly RoleCode[];
  /** Permissions effectives, résolues en base. Miroir d'affichage de la RLS. */
  readonly permissions: readonly Permission[];
}
