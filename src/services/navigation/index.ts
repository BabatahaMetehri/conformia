import "server-only";

/**
 * Résolution de la navigation pour la requête courante.
 *
 * Le filtrage se fait ICI, côté serveur, avant que quoi que ce soit n'atteigne
 * le navigateur : une entrée interdite n'est pas rendue puis masquée, elle est
 * absente de la charge utile. La différence se voit dans le code source de la
 * page, et c'est la seule qui compte.
 */

import {
  filterNavigation,
  firstLeafPath,
  NAVIGATION,
  requirementForPath,
  type NavCounters,
  type NavItem,
} from "@/config/navigation";
import type { Permission } from "@/config/permissions";
import { getNavigationCounters } from "@/data/queries/navigation";
import { logger } from "@/lib/logger";
import { ok, type Result } from "@/lib/result";
import { getAuthContext, requireAuthContext, type AuthContext } from "@/services/auth/context";

const ZERO_COUNTERS: NavCounters = { overdue: 0, pendingValidation: 0, myTasks: 0 };

export interface ResolvedNavigation {
  readonly items: readonly NavItem[];
  readonly counters: NavCounters;
}

/**
 * Arbre filtré + compteurs, prêts à traverser la frontière RSC.
 *
 * Un échec de compteur ne fait pas échouer la navigation : mieux vaut une
 * barre latérale sans pastille qu'une application injoignable parce qu'un
 * agrégat n'a pas répondu. L'incident est journalisé, pas montré.
 */
export async function getResolvedNavigation(): Promise<Result<ResolvedNavigation>> {
  const context = await requireAuthContext();
  if (!context.ok) return context;

  const items = filterNavigation(NAVIGATION, context.value.permissions);

  const counters = await getNavigationCounters();
  if (!counters.ok) {
    logger.error("Compteurs de navigation indisponibles", { code: counters.error.code });
    return ok({ items, counters: ZERO_COUNTERS });
  }

  return ok({
    items,
    counters: {
      overdue: counters.value.overdue,
      pendingValidation: counters.value.pendingValidation,
      myTasks: counters.value.myTasks,
    },
  });
}

// ─── Garde de route ──────────────────────────────────────────────────────────

/**
 * L'utilisateur peut-il atteindre ce chemin ?
 *
 * La condition est lue dans le MÊME arbre que celui qui a masqué le lien. La
 * réécrire dans chaque écran produirait deux formulations vouées à diverger — et
 * le jour où elles divergent, c'est la moins stricte qui gagne.
 *
 * Un chemin inconnu de l'arbre est autorisé : les écrans hors sommaire (profil,
 * flux calendrier) n'exigent rien de plus qu'une session.
 */
export async function canAccessPath(path: string): Promise<boolean> {
  const requirement = requirementForPath(path);

  const context = await getAuthContext();
  if (!context.ok || context.value === null) return false;
  if (requirement === null) return true;

  return matches(requirement, context.value.permissions);
}

function matches(
  requirement: NonNullable<ReturnType<typeof requirementForPath>>,
  granted: ReadonlySet<Permission>,
): boolean {
  switch (requirement.kind) {
    case "always":
      return true;
    case "any":
      return requirement.permissions.some((permission) => granted.has(permission));
    case "all":
      return requirement.permissions.every((permission) => granted.has(permission));
  }
}

/** Première destination ouverte à cet utilisateur. Voir `firstLeafPath`. */
export function firstAccessiblePath(context: AuthContext): string {
  return firstLeafPath(filterNavigation(NAVIGATION, context.permissions));
}
