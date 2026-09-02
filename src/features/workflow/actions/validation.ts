"use server";

/**
 * Server Actions du circuit de validation.
 *
 * ⚠️ Aucune de ces actions ne décide quoi que ce soit. Chacune appelle le
 * service, qui appelle la base, qui consulte `evaluate_transition`. Une
 * permission vérifiée ici et nulle part ailleurs serait une permission qu'un
 * appel direct contournerait.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { OCCURRENCE_STATUSES } from "@/config/constants";
import type {
  BulkOutcome,
  ReviewOutcome,
  DelegationOutcome,
  PlainWorkflowOutcome,
  ValidationOutcome,
} from "@/features/workflow/actions/types";
import { toClientError } from "@/lib/errors";
import { getOccurrenceDetail, transitionOccurrence } from "@/services/occurrences/detail";
import { createDelegation, revoke } from "@/services/workflow/delegations";
import { isBulkValidatable } from "@/services/workflow/queue";
import { getValidationQueue } from "@/services/workflow/queue";
import { uuidSchema } from "@/lib/schemas";

const QUEUE_PATH = "/[locale]/(app)/validation";
const DETAIL_PATH = "/[locale]/(app)/echeancier/[occurrenceId]";
const DELEGATIONS_PATH = "/[locale]/(app)/admin/delegations";

function invalid(): { readonly status: "error"; readonly error: ReturnType<typeof toClientError> } {
  return {
    status: "error",
    error: { code: "VALIDATION_FAILED", message: "errors.validationFailed", httpStatus: 422 },
  };
}

const DecideSchema = z.object({
  occurrenceId: uuidSchema,
  toStatus: z.enum(OCCURRENCE_STATUSES),
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().max(2000).nullable(),
});

/** Valider ou rejeter un dossier depuis la file, sans quitter l'écran. */
export async function decideAction(input: unknown): Promise<ValidationOutcome> {
  const parsed = DecideSchema.safeParse(input);
  if (!parsed.success) return invalid();

  // ⚠️ Les champs facultatifs sont OMIS, jamais passés à `null` :
  // `exactOptionalPropertyTypes` distingue les deux, et c'est la base qui décide
  // de ce qu'un champ absent signifie.
  const result = await transitionOccurrence({
    occurrenceId: parsed.data.occurrenceId,
    toStatus: parsed.data.toStatus,
    expectedVersion: parsed.data.expectedVersion,
    ...(parsed.data.reason === null ? {} : { reason: parsed.data.reason }),
  });

  if (!result.ok) return { status: "error", error: toClientError(result.error) };

  revalidatePath(QUEUE_PATH, "page");
  revalidatePath(DETAIL_PATH, "page");
  return { status: "success", data: result.value };
}

const BulkSchema = z.object({
  occurrenceIds: z.array(uuidSchema).min(1).max(50),
});

/**
 * Validation GROUPÉE.
 *
 * ⚠️ Le filtre de criticité est réappliqué ICI, sur les données de la file, et
 * non sur ce que le client envoie : un identifiant de dossier CRITICAL glissé
 * dans la requête ne doit pas passer parce que l'interface, elle, ne l'aurait
 * pas proposé. Valider en lot suppose qu'on n'a pas ouvert chaque dossier —
 * acceptable pour une déclaration de routine, jamais pour celles dont l'erreur
 * se paie en pénalités.
 *
 * Chaque dossier est traité SÉPARÉMENT : un refus n'annule pas les autres, et
 * l'appelant reçoit la liste de ce qui n'est pas passé. Un lot tout-ou-rien
 * obligerait à recommencer l'ensemble pour un seul dossier récalcitrant.
 */
export async function bulkValidateAction(input: unknown): Promise<BulkOutcome> {
  const parsed = BulkSchema.safeParse(input);
  if (!parsed.success) return invalid();

  const queue = await getValidationQueue();
  if (!queue.ok) return { status: "error", error: toClientError(queue.error) };

  const requested = new Set(parsed.data.occurrenceIds);
  const eligible = queue.value.filter(
    (row) => requested.has(row.id) && isBulkValidatable(row.criticality),
  );

  const refused: { occurrenceId: string; outcome: string }[] = [];
  let applied = 0;

  for (const row of eligible) {
    const result = await transitionOccurrence({
      occurrenceId: row.id,
      toStatus: "VALIDATED",
      expectedVersion: row.version,
    });

    if (!result.ok) {
      refused.push({ occurrenceId: row.id, outcome: result.error.code });
      continue;
    }
    if (result.value.outcome === "APPLIED" || result.value.outcome === "PARTIALLY_VALIDATED") {
      applied += 1;
      continue;
    }
    refused.push({ occurrenceId: row.id, outcome: result.value.outcome });
  }

  // Les dossiers écartés par la règle de criticité sont rapportés eux aussi :
  // un silence laisserait croire qu'ils ont été validés.
  for (const id of requested) {
    if (!eligible.some((row) => row.id === id)) {
      refused.push({ occurrenceId: id, outcome: "BULK_NOT_ALLOWED" });
    }
  }

  revalidatePath(QUEUE_PATH, "page");
  return { status: "success", data: { applied, refused } };
}

const CreateDelegationSchema = z.object({
  delegatorId: uuidSchema,
  delegateId: uuidSchema,
  domainId: uuidSchema.nullable(),
  startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(10).max(2000),
});

export async function createDelegationAction(input: unknown): Promise<DelegationOutcome> {
  const parsed = CreateDelegationSchema.safeParse(input);
  if (!parsed.success) return invalid();

  const result = await createDelegation(parsed.data);
  if (!result.ok) return { status: "error", error: toClientError(result.error) };

  revalidatePath(DELEGATIONS_PATH, "page");
  return { status: "success", data: { id: result.value } };
}

const RevokeSchema = z.object({
  delegationId: uuidSchema,
  reason: z.string().trim().min(10).max(2000),
});

export async function revokeDelegationAction(input: unknown): Promise<PlainWorkflowOutcome> {
  const parsed = RevokeSchema.safeParse(input);
  if (!parsed.success) return invalid();

  const result = await revoke(parsed.data.delegationId, parsed.data.reason);
  if (!result.ok) return { status: "error", error: toClientError(result.error) };

  revalidatePath(DELEGATIONS_PATH, "page");
  return { status: "success", data: result.value };
}

const ReviewSchema = z.object({ occurrenceId: uuidSchema });

/**
 * Charge de quoi contrôler un dossier SANS quitter la file.
 *
 * ⚠️ Renvoie une vue RÉDUITE — complétude, pièces, dernières étapes — et non la
 * fiche entière : le validateur doit pouvoir décider vite, et charger six
 * onglets pour en lire deux ralentirait la file au point qu'on la contournerait.
 * Le lien vers la fiche complète reste offert pour les cas qui l'exigent.
 */
export async function loadReviewAction(input: unknown): Promise<ReviewOutcome> {
  const parsed = ReviewSchema.safeParse(input);
  if (!parsed.success) return invalid();

  const detail = await getOccurrenceDetail(parsed.data.occurrenceId);
  if (!detail.ok) return { status: "error", error: toClientError(detail.error) };

  return {
    status: "success",
    data: {
      completeness: detail.value.completeness,
      checklist: detail.value.checklist.map((line) => ({
        id: line.id,
        label: line.label,
        isMandatory: line.isMandatory,
        hasDocument: line.document !== null,
        documentId: line.document?.id ?? null,
        documentName: line.document?.originalFilename ?? null,
      })),
      timeline: detail.value.timeline.slice(0, 6).map((entry) => ({
        id: entry.id,
        occurredAt: entry.occurredAt,
        actorName: entry.actorName,
        onBehalfOfName: entry.onBehalfOfName,
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        reason: entry.reason,
      })),
    },
  };
}
