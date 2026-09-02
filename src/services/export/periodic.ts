import "server-only";

/**
 * EXPORT PÉRIODIQUE — un exercice, un contrôle fiscal.
 *
 * ⚠️ LE SEUIL EST UNE DÉCISION D'EXPLOITATION, pas une optimisation. En deçà,
 * l'archive part dans la réponse HTTP : l'utilisateur clique, le fichier arrive.
 * Au-delà, la construction dépasse le temps qu'un navigateur accepte d'attendre
 * — et une requête coupée à mi-chemin laisse une archive tronquée que rien ne
 * signale. Mieux vaut un message « vous serez prévenu » qu'un fichier corrompu.
 */

import { formatDateFr } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { loadMyExportScope, startExportRun, type ExportScopeFilters } from "@/data/queries/export";

/**
 * Au-delà de cinquante occurrences, l'export bascule en tâche de fond.
 *
 * Cinquante n'est pas un chiffre rond choisi au hasard : c'est l'ordre de
 * grandeur d'un trimestre pour AGROESPACE, et donc la limite entre « je consulte
 * une période » et « j'archive un exercice ».
 */
export const ASYNC_THRESHOLD = 50;

export type PeriodicOutcome =
  | { readonly mode: "SYNC"; readonly occurrenceCount: number }
  | { readonly mode: "ASYNC"; readonly runId: string; readonly occurrenceCount: number };

/** Libellé lisible du périmètre, pour le journal et pour l'écran. */
export function describeScope(filters: ExportScopeFilters, unbounded: string): string {
  const from =
    filters.from === undefined ? null : formatDateFr(new Date(`${filters.from}T12:00:00Z`));
  const to = filters.to === undefined ? null : formatDateFr(new Date(`${filters.to}T12:00:00Z`));

  if (from === null && to === null) return unbounded;
  return `${from ?? "…"} → ${to ?? "…"}`;
}

/**
 * Décide du mode et ouvre la ligne de journal.
 *
 * ⚠️ Le comptage passe par le périmètre de l'APPELANT. Un utilisateur RH qui
 * demande un exercice complet compte ses propres dossiers sociaux, pas ceux de
 * l'entreprise : le seuil se déclenche donc sur ce qu'il obtiendra réellement, et
 * non sur ce qu'il croit demander.
 */
export async function planPeriodicExport(
  filters: ExportScopeFilters,
  scopeLabel: string,
): Promise<Result<PeriodicOutcome>> {
  const scope = await loadMyExportScope(filters);
  if (!scope.ok) return err(scope.error);

  if (scope.value.length === 0) {
    return err(AppError.validationFailed({ reason: "EXPORT_EMPTY" }));
  }

  const count = scope.value.length;

  if (count <= ASYNC_THRESHOLD) {
    return ok({ mode: "SYNC", occurrenceCount: count });
  }

  const run = await startExportRun({
    kind: "PERIOD",
    format: "ZIP",
    scope: {
      from: filters.from ?? null,
      to: filters.to ?? null,
      domainId: filters.domainId ?? null,
      authorityId: filters.authorityId ?? null,
      label: scopeLabel,
      // Le compte est inscrit DÈS LA DEMANDE : si la tâche échoue, on saura
      // combien de dossiers étaient attendus, ce que la ligne finale ne dirait
      // plus.
      expected: count,
    },
    isAsync: true,
  });

  if (!run.ok) return err(run.error);

  return ok({ mode: "ASYNC", runId: run.value, occurrenceCount: count });
}
