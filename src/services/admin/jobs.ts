import "server-only";

/**
 * Surveillance des travaux planifiés.
 *
 * ⚠️ Ce service ne recalcule AUCUN verdict. « À jour / périmé / jamais
 * exécuté » est décidé par la vue `job_health`, en base, où le même calcul sert
 * aux alertes. Le refaire ici créerait une seconde source de vérité, et le jour
 * où les deux divergeraient, l'écran rassurerait pendant que l'alerte crierait.
 *
 * Il existe pour tenir la frontière de couches : l'interface n'atteint jamais
 * `data/` directement (CLAUDE.md §3.1).
 */

import {
  listJobHealth,
  listRecentJobRuns,
  type JobHealthRow,
  type JobRunRow,
  type JobVerdict,
} from "@/data/queries/jobs";
import type { Result } from "@/lib/result";

export type { JobHealthRow, JobRunRow, JobVerdict };

/** Le verdict de chaque travail attendu, ABSENCE COMPRISE. */
export async function getJobHealth(): Promise<Result<readonly JobHealthRow[]>> {
  return listJobHealth();
}

/** Les dernières exécutions, tous travaux confondus. */
export async function getRecentJobRuns(limit?: number): Promise<Result<readonly JobRunRow[]>> {
  return listRecentJobRuns(limit);
}
