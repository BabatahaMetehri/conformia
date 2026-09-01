import "server-only";

/**
 * Écritures liées aux pièces.
 *
 * ⚠️ AUCUNE fonction de ce module ne reçoit ni ne renvoie le contenu d'un
 * fichier. Depuis 0009, les octets vont du navigateur au stockage sans passer
 * par le serveur applicatif : celui-ci n'émet qu'une autorisation d'écrire
 * (`createSignedUploadUrl`) puis relit les premiers octets de ce qui a été
 * écrit, le temps d'en vérifier la signature. Une fonction qui prendrait un
 * `Uint8Array` de 25 Mo serait le retour du modèle qu'on vient d'abandonner.
 *
 * La journalisation d'accès passe obligatoirement par `log_document_access` :
 * l'insertion directe est révoquée pour tous les rôles, y compris service_role,
 * afin qu'un `actor_id` ne puisse pas être forgé.
 */

import { AppError, mapPostgrestError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DocumentId } from "@/types/domain";

export type DocumentAccessAction = "SIGNED_URL_ISSUED" | "VIEW" | "DOWNLOAD";

export interface DocumentAccessContext {
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

export async function logDocumentAccess(
  documentId: DocumentId,
  action: DocumentAccessAction,
  context: DocumentAccessContext,
): Promise<Result<null>> {
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.rpc("log_document_access", {
    p_document_id: documentId,
    p_action: action,
    ...(context.ipAddress === null ? {} : { p_ip: context.ipAddress }),
    ...(context.userAgent === null ? {} : { p_user_agent: context.userAgent }),
  });

  if (error !== null) return err(mapPostgrestError(error));
  return ok(null);
}

// ─── Étape 1 : le billet ─────────────────────────────────────────────────────

/** Issues rendues par `create_document_upload_ticket`. */
export type TicketOutcomeCode =
  | "ISSUED"
  | "NOT_FOUND"
  | "DENIED"
  | "OCCURRENCE_LOCKED"
  | "INVALID_CHECKLIST_ITEM"
  | "INVALID_NAME"
  | "MIME_NOT_ALLOWED"
  | "EMPTY_FILE"
  | "TOO_LARGE"
  | "QUOTA_EXCEEDED";

export interface TicketOutcome {
  readonly outcome: TicketOutcomeCode;
  readonly ticketId: string | null;
  readonly storagePath: string | null;
  readonly normalizedFilename: string | null;
  readonly version: number | null;
  readonly expiresInSeconds: number | null;
  readonly usedBytes: number | null;
  readonly quotaBytes: number | null;
}

function readTicketOutcome(payload: unknown): TicketOutcome {
  const record = (payload ?? {}) as Record<string, unknown>;
  const asText = (key: string): string | null =>
    typeof record[key] === "string" ? record[key] : null;
  const asNumber = (key: string): number | null =>
    typeof record[key] === "number" ? record[key] : null;

  return {
    outcome: (record["status"] as TicketOutcomeCode | undefined) ?? "NOT_FOUND",
    ticketId: asText("ticket_id"),
    storagePath: asText("storage_path"),
    normalizedFilename: asText("normalized_filename"),
    version: asNumber("version"),
    expiresInSeconds: asNumber("expires_in_seconds"),
    usedBytes: asNumber("used_bytes"),
    quotaBytes: asNumber("quota_bytes"),
  };
}

export interface TicketRequest {
  readonly occurrenceId: string;
  readonly checklistItemId: string | null;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly documentKind: string | null;
  readonly slug: string;
  readonly extension: string | null;
  readonly nameStem: string;
}

export async function createUploadTicket(request: TicketRequest): Promise<Result<TicketOutcome>> {
  const supabase = await createSupabaseServerClient();

  // ⚠️ Les paramètres facultatifs sont OMIS, jamais passés à `undefined` :
  // `exactOptionalPropertyTypes` distingue les deux, et la fonction SQL a ses
  // propres valeurs par défaut (null). Envoyer la clé absente laisse la base décider.
  const { data, error } = await supabase.rpc("create_document_upload_ticket", {
    p_occurrence_id: request.occurrenceId,
    p_original_filename: request.originalFilename,
    p_mime_type: request.mimeType,
    p_size_bytes: request.sizeBytes,
    p_slug: request.slug,
    p_name_stem: request.nameStem,
    ...(request.checklistItemId === null ? {} : { p_checklist_item_id: request.checklistItemId }),
    ...(request.documentKind === null ? {} : { p_document_kind: request.documentKind }),
    ...(request.extension === null ? {} : { p_extension: request.extension }),
  });

  if (error !== null) return err(mapPostgrestError(error));
  return ok(readTicketOutcome(data));
}

/**
 * Autorisation d'écrire UN objet, à UN chemin, une seule fois.
 *
 * Le jeton rendu ne vaut que pour ce chemin : il ne donne aucun droit de
 * lecture, aucun droit d'écraser un objet existant, et rien ailleurs dans le
 * bucket. C'est ce qui permet de confier l'envoi au navigateur sans lui confier
 * le stockage.
 */
export async function createSignedUploadUrl(
  bucket: string,
  path: string,
): Promise<Result<{ readonly signedUrl: string; readonly token: string }>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(path);

  if (error !== null) {
    return err(AppError.storageFailed("create-signed-upload-url", { cause: error }));
  }
  return ok({ signedUrl: data.signedUrl, token: data.token });
}

// ─── Étape 2 : la confirmation ───────────────────────────────────────────────

export type ConfirmOutcomeCode =
  | "CREATED"
  | "TICKET_NOT_FOUND"
  | "TICKET_EXPIRED"
  | "TICKET_REJECTED"
  | "ALREADY_CONSUMED"
  | "INVALID_HASH"
  | "SIZE_MISMATCH"
  | "DENIED"
  | "OCCURRENCE_LOCKED";

export interface ConfirmOutcome {
  readonly outcome: ConfirmOutcomeCode;
  readonly documentId: string | null;
  readonly version: number | null;
  readonly normalizedFilename: string | null;
  readonly declared: number | null;
  readonly actual: number | null;
}

function readConfirmOutcome(payload: unknown): ConfirmOutcome {
  const record = (payload ?? {}) as Record<string, unknown>;
  const asText = (key: string): string | null =>
    typeof record[key] === "string" ? record[key] : null;
  const asNumber = (key: string): number | null =>
    typeof record[key] === "number" ? record[key] : null;

  return {
    outcome: (record["status"] as ConfirmOutcomeCode | undefined) ?? "TICKET_NOT_FOUND",
    documentId: asText("document_id"),
    version: asNumber("version"),
    normalizedFilename: asText("normalized_filename"),
    declared: asNumber("declared"),
    actual: asNumber("actual"),
  };
}

export async function confirmUpload(input: {
  readonly ticketId: string;
  readonly sha256: string;
  readonly detectedMimeType: string | null;
  readonly actualSize: number;
}): Promise<Result<ConfirmOutcome>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("confirm_document_upload", {
    p_ticket_id: input.ticketId,
    p_sha256: input.sha256,
    p_actual_size: input.actualSize,
    ...(input.detectedMimeType === null ? {} : { p_detected_mime_type: input.detectedMimeType }),
  });

  if (error !== null) return err(mapPostgrestError(error));
  return ok(readConfirmOutcome(data));
}

/**
 * Clôt un billet dont le contrôle serveur a démenti le contenu.
 *
 * Le billet est conservé : c'est la trace qu'un fichier suspect a été envoyé.
 * L'objet, lui, reste dans le bucket — illisible faute de ligne `documents` — et
 * sera balayé par la tâche de ménage, seul endroit détenant les droits pour le
 * faire (cf. `abandoned_upload_objects`).
 */
export async function rejectUploadTicket(
  ticketId: string,
  reason: string,
): Promise<Result<boolean>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("reject_document_upload_ticket", {
    p_ticket_id: ticketId,
    p_reason: reason,
  });

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data);
}

// ─── Retrait ─────────────────────────────────────────────────────────────────

/**
 * Retrait LOGIQUE d'une pièce.
 *
 * Passe par `soft_delete_document()`. ⚠️ Un UPDATE direct est REFUSÉ par la RLS :
 * poser `deleted_at` fait sortir la ligne de `documents_select`, et PostgreSQL
 * refuse une ligne résultante que les politiques SELECT ne couvrent plus.
 *
 * L'objet reste dans le bucket : aucune politique DELETE n'y existe, délibérément.
 */
export async function softDeleteDocument(
  documentId: DocumentId,
  reason: string,
): Promise<Result<boolean>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("soft_delete_document", {
    p_document_id: documentId,
    p_reason: reason,
  });

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data);
}

export async function acknowledgeIntegrityAlert(
  checkId: number,
  note: string,
): Promise<Result<boolean>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("acknowledge_integrity_alert", {
    p_check_id: checkId,
    p_note: note,
  });

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data);
}
