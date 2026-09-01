import "server-only";

/**
 * Écritures de la fiche d'occurrence.
 *
 * Couche data : elle traduit une intention en requête, elle ne décide rien. Les
 * gardes (transition permise, permission de l'acteur, motif obligatoire,
 * complétude, version attendue) sont portées par la BASE — triggers et fonctions
 * de 0001/0002/0008. Ce module ne les répète pas : il en lit le verdict.
 */

import { mapPostgrestError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { OccurrenceStatus } from "@/config/constants";
import type { OccurrenceId, ProfileId } from "@/types/domain";

/**
 * Vocabulaire des issues rendues par `apply_occurrence_transition`.
 *
 * ⚠️ Depuis 0010, la fonction délègue TOUTE la décision à `evaluate_transition` :
 * ce vocabulaire est donc celui des verdicts, augmenté de ce que seule
 * l'application peut constater — le conflit de version et l'issue effective.
 * L'énumérer ici n'est pas une seconde source de règles : c'est la liste des
 * réponses possibles, et le service doit toutes les traiter.
 */
export type TransitionOutcomeCode =
  | "APPLIED"
  | "NO_CHANGE"
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "INCOMPLETE"
  | "REFERENCE_REQUIRED"
  | "PROOF_REQUIRED"
  | "LATE_REASON_REQUIRED"
  | "INVALID_TRANSITION"
  | "LOCKED"
  | "FORBIDDEN"
  | "REASON_REQUIRED"
  | "SELF_VALIDATION_BLOCKED"
  | "SECOND_LEVEL_REQUIRES_DIRECTION"
  /** Première des deux validations : enregistrée, mais l'état ne change pas. */
  | "PARTIALLY_VALIDATED";

export interface TransitionOutcome {
  readonly outcome: TransitionOutcomeCode;
  readonly version: number | null;
  readonly status: OccurrenceStatus | null;
  readonly missing: readonly string[];
  readonly dueDate: string | null;
  /** Validations obtenues / exigées, quand l'obligation en demande deux. */
  readonly obtained: number | null;
  readonly required: number | null;
}

export type LateReasonCode =
  | "MISSING_DOCUMENT"
  | "VALIDATOR_UNAVAILABLE"
  | "LATE_EXTERNAL_INFORMATION"
  | "OVERSIGHT"
  | "OTHER";

export interface TransitionRequest {
  readonly occurrenceId: OccurrenceId;
  readonly toStatus: OccurrenceStatus;
  readonly expectedVersion: number;
  readonly reason: string | null;
  readonly referenceNumber: string | null;
  readonly lateReasonCode: LateReasonCode | null;
  readonly lateReason: string | null;
}

function readOutcome(payload: unknown): TransitionOutcome {
  const record = (payload ?? {}) as Record<string, unknown>;
  const missing = record["missing"];

  return {
    outcome: (record["outcome"] as TransitionOutcomeCode | undefined) ?? "NOT_FOUND",
    version: typeof record["version"] === "number" ? record["version"] : null,
    status: (record["status"] as OccurrenceStatus | undefined) ?? null,
    missing: Array.isArray(missing) ? missing.map((entry) => String(entry)) : [],
    dueDate: typeof record["dueDate"] === "string" ? record["dueDate"] : null,
    obtained: typeof record["obtained"] === "number" ? record["obtained"] : null,
    required: typeof record["required"] === "number" ? record["required"] : null,
  };
}

export async function applyTransition(
  request: TransitionRequest,
): Promise<Result<TransitionOutcome>> {
  const supabase = await createSupabaseServerClient();

  // ⚠️ Les paramètres facultatifs sont OMIS, jamais passés à `undefined` :
  // `exactOptionalPropertyTypes` distingue les deux, et la fonction SQL a ses
  // propres valeurs par défaut. Envoyer la clé absente laisse la base décider.
  const { data, error } = await supabase.rpc("apply_occurrence_transition", {
    p_occurrence_id: request.occurrenceId,
    p_to_status: request.toStatus,
    p_expected_version: request.expectedVersion,
    ...(request.reason === null ? {} : { p_reason: request.reason }),
    ...(request.referenceNumber === null ? {} : { p_reference_number: request.referenceNumber }),
    ...(request.lateReasonCode === null ? {} : { p_late_reason_code: request.lateReasonCode }),
    ...(request.lateReason === null ? {} : { p_late_reason: request.lateReason }),
  });

  // Une transition INEXISTANTE ou une permission manquante lève côté base : elle
  // arrive ici en erreur PostgREST, pas en issue. C'est voulu — les issues
  // décrivent ce que l'utilisateur peut corriger, les exceptions ce qu'il ne peut pas.
  if (error !== null) return err(mapPostgrestError(error));
  return ok(readOutcome(data));
}

export async function createRectification(
  occurrenceId: OccurrenceId,
  reason: string,
): Promise<Result<string>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("create_occurrence_rectification", {
    p_occurrence_id: occurrenceId,
    p_reason: reason,
  });

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data);
}

export interface NewComment {
  readonly occurrenceId: OccurrenceId;
  readonly authorId: ProfileId;
  readonly body: string;
  readonly mentionedUserIds: readonly string[];
}

export async function insertComment(comment: NewComment): Promise<Result<string>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("occurrence_comments")
    .insert({
      occurrence_id: comment.occurrenceId,
      author_id: comment.authorId,
      body: comment.body,
      mentioned_user_ids: [...comment.mentionedUserIds],
    })
    .select("id")
    .single();

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data.id);
}

/**
 * Suppression LOGIQUE d'un commentaire.
 *
 * Passe par `soft_delete_comment()`. ⚠️ Un UPDATE direct est REFUSÉ par la RLS :
 * la politique de lecture filtre `deleted_at is null`, et PostgreSQL exige que la
 * ligne résultante d'un UPDATE satisfasse encore les politiques SELECT. La ligne
 * survit, l'audit conserve son texte ; la lecture, elle, ne la montre plus.
 */
export async function softDeleteComment(commentId: string): Promise<Result<boolean>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("soft_delete_comment", {
    p_comment_id: commentId,
  });

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data);
}

/** Réaffectation d'un dossier unique — même fonction bornée que le lot. */
export async function reassignSingle(
  occurrenceId: OccurrenceId,
  ownerId: ProfileId,
): Promise<Result<number>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("reassign_occurrences", {
    p_occurrence_ids: [occurrenceId as string],
    p_owner_id: ownerId,
  });

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data);
}
