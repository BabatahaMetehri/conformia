import "server-only";

/**
 * Compteurs affichés dans la barre latérale.
 *
 * Un seul aller-retour pour les trois : la coquille est rendue à chaque
 * navigation, trois requêtes séparées y coûteraient trois fois plus cher pour
 * la même information.
 */

import { mapPostgrestError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface NavigationCountersRow {
  readonly overdue: number;
  readonly pendingValidation: number;
  readonly myTasks: number;
}

const EMPTY: NavigationCountersRow = { overdue: 0, pendingValidation: 0, myTasks: 0 };

/**
 * ⚠️ `navigation_counters()` est SECURITY INVOKER : elle compte SOUS la RLS de
 * l'appelant. Un utilisateur du domaine social ne peut donc pas déduire, du
 * compteur « en retard », combien de dossiers fiscaux sont en souffrance. Un
 * compteur fuit aussi sûrement qu'une liste.
 */
export async function getNavigationCounters(): Promise<Result<NavigationCountersRow>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("navigation_counters");
  if (error !== null) return err(mapPostgrestError(error));

  const row = data[0];
  // Aucune ligne : la fonction agrège, elle en rend toujours une. Le cas ne se
  // produit pas — on le traite quand même plutôt que de déréférencer à l'aveugle.
  if (row === undefined) return ok(EMPTY);

  return ok({
    overdue: row.overdue,
    pendingValidation: row.pending_validation,
    myTasks: row.my_tasks,
  });
}
