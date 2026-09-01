import "server-only";

/**
 * File de validation.
 *
 * ⚠️ Aucun filtre de confidentialité ni d'habilitation n'est appliqué ici. La
 * vue `validation_queue` est en `security_invoker` et appelle
 * `can_validate_occurrence` — délégations comprises — ainsi que la séparation
 * des pouvoirs. Refiltrer en TypeScript créerait une seconde règle d'accès,
 * qui divergerait de la première.
 */

import {
  BULK_VALIDATABLE_CRITICALITIES,
  isBulkValidatable,
  sortQueue,
} from "@/lib/validation-priority";
import {
  countPendingValidations,
  listValidationQueue,
  type ValidationQueueRow,
} from "@/data/queries/workflow";
import { ok, type Result } from "@/lib/result";
import { requirePermission } from "@/services/auth/context";

export type { ValidationQueueRow };

// Les règles de priorisation vivent dans `@/lib/validation-priority` : pures,
// donc éprouvables sans processus serveur. Réexportées ici pour que l'appelant
// n'ait qu'une porte d'entrée.
export { BULK_VALIDATABLE_CRITICALITIES, isBulkValidatable, sortQueue };

export async function getValidationQueue(): Promise<Result<readonly ValidationQueueRow[]>> {
  const context = await requirePermission("occurrence.read");
  if (!context.ok) return context;

  const rows = await listValidationQueue();
  if (!rows.ok) return rows;

  return ok(sortQueue(rows.value));
}

/**
 * Compteur affiché dans la navigation.
 *
 * Se replie sur zéro plutôt que d'échouer : un badge est un confort, et un
 * écran entier ne doit pas tomber parce qu'un compteur n'a pas pu être lu.
 */
export async function getPendingValidationCount(): Promise<number> {
  const count = await countPendingValidations();
  return count.ok ? count.value : 0;
}
