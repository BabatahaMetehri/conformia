"use server";

/**
 * Server Actions de l'échéancier.
 *
 * Chaîne imposée : permission → validation Zod → service → revalidatePath →
 * Result sérialisable.
 *
 * ⚠️ Le contrôle de permission est DANS l'action. Une Server Action est un point
 * d'entrée HTTP à part entière : masquer un bouton ne protège rien. Le service
 * revérifie, et la RLS refuse en dernier ressort.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { toClientError } from "@/lib/errors";
import type { Result } from "@/lib/result";
import { requirePermission } from "@/services/auth/context";
import { OccurrenceFiltersSchema, reassign, rememberFilters } from "@/services/occurrences";
import { exportOccurrencesXlsx, type ExportLabels } from "@/services/occurrences/export";
import type {
  ActionOutcome,
  ExportOutcome,
  ReassignOutcome,
  RememberOutcome,
} from "@/features/occurrences/actions/types";

const LIST_PATH = "/[locale]/(app)/echeancier";

function toOutcome<T>(result: Result<T>): ActionOutcome<T> {
  return result.ok
    ? { status: "success", data: result.value }
    : { status: "error", error: toClientError(result.error) };
}

const ReassignSchema = z.object({
  occurrenceIds: z.array(z.uuid()).min(1).max(500),
  ownerId: z.uuid(),
});

export async function reassignOccurrencesAction(input: unknown): Promise<ReassignOutcome> {
  const context = await requirePermission("occurrence.assign");
  if (!context.ok) return { status: "error", error: toClientError(context.error) };

  const parsed = ReassignSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      error: { code: "VALIDATION_FAILED", message: "errors.validationFailed", httpStatus: 422 },
    };
  }

  const result = await reassign(parsed.data.occurrenceIds, parsed.data.ownerId);
  if (result.ok) revalidatePath(LIST_PATH, "page");
  return toOutcome(result);
}

/**
 * Export de la vue courante.
 *
 * Les LIBELLÉS traversent depuis le client : le service n'a pas de catalogue de
 * traduction, et un export dont les en-têtes seraient écrits en dur violerait
 * l'interdiction de chaîne codée en dur (CLAUDE.md §6).
 */
export async function exportOccurrencesAction(
  rawFilters: unknown,
  labels: Omit<ExportLabels, "statusOf" | "criticalityOf"> & {
    readonly statuses: Record<string, string>;
    readonly criticalities: Record<string, string>;
  },
): Promise<ExportOutcome> {
  const context = await requirePermission("export.generate");
  if (!context.ok) return { status: "error", error: toClientError(context.error) };

  const filters = OccurrenceFiltersSchema.safeParse(rawFilters);
  if (!filters.success) {
    return {
      status: "error",
      error: { code: "VALIDATION_FAILED", message: "errors.validationFailed", httpStatus: 422 },
    };
  }

  const result = await exportOccurrencesXlsx(filters.data, {
    ...labels,
    statusOf: (status) => labels.statuses[status] ?? status,
    criticalityOf: (criticality) => labels.criticalities[criticality] ?? criticality,
  });

  return toOutcome(result);
}

/** Mémorise les filtres. Aucune revalidation : rien d'affiché n'en dépend. */
export async function rememberFiltersAction(rawFilters: unknown): Promise<RememberOutcome> {
  const parsed = OccurrenceFiltersSchema.safeParse(rawFilters);
  if (!parsed.success) {
    return {
      status: "error",
      error: { code: "VALIDATION_FAILED", message: "errors.validationFailed", httpStatus: 422 },
    };
  }
  return toOutcome(await rememberFilters(parsed.data));
}
