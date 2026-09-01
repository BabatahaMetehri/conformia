import "server-only";

/**
 * Écritures liées aux pièces.
 *
 * La journalisation d'accès passe obligatoirement par la fonction SQL
 * `log_document_access` : l'insertion directe est révoquée pour tous les rôles,
 * y compris service_role, afin qu'un `actor_id` ne puisse pas être forgé.
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

// ─── Dépôt d'une pièce ───────────────────────────────────────────────────────

export interface StorageUpload {
  readonly bucket: string;
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

/**
 * Écrit l'objet dans le bucket privé.
 *
 * `upsert: false` : un chemin déjà pris fait échouer le dépôt plutôt que
 * d'écraser. Le chemin contient l'identifiant du document, donc une collision
 * signale une anomalie, jamais un remplacement légitime — un remplacement est un
 * NOUVEL objet (CLAUDE.md §1, intégrité).
 */
export async function uploadDocumentObject(upload: StorageUpload): Promise<Result<null>> {
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.storage.from(upload.bucket).upload(upload.path, upload.bytes, {
    contentType: upload.contentType,
    upsert: false,
  });

  if (error !== null) return err(AppError.storageFailed("upload", { cause: error }));
  return ok(null);
}

export interface NewDocument {
  readonly id: string;
  readonly occurrenceId: string;
  readonly checklistItemId: string | null;
  readonly bucket: string;
  readonly storagePath: string;
  readonly originalFilename: string;
  readonly normalizedFilename: string;
  readonly mimeType: string;
  readonly detectedMimeType: string | null;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly version: number;
  readonly supersedesId: string | null;
  readonly documentKind: string | null;
  readonly uploadedBy: string;
}

export async function insertDocument(document: NewDocument): Promise<Result<string>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("documents")
    .insert({
      id: document.id,
      occurrence_id: document.occurrenceId,
      checklist_item_id: document.checklistItemId,
      bucket: document.bucket,
      storage_path: document.storagePath,
      original_filename: document.originalFilename,
      normalized_filename: document.normalizedFilename,
      mime_type: document.mimeType,
      detected_mime_type: document.detectedMimeType,
      size_bytes: document.sizeBytes,
      sha256: document.sha256,
      version: document.version,
      supersedes_id: document.supersedesId,
      document_kind: document.documentKind,
      uploaded_by: document.uploadedBy,
    })
    .select("id")
    .single();

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data.id);
}

/**
 * Retrait LOGIQUE d'une pièce.
 *
 * Passe par `soft_delete_document()`. ⚠️ Un UPDATE direct est REFUSÉ par la RLS,
 * pour la même raison que les commentaires : poser `deleted_at` fait sortir la
 * ligne de `documents_select`, et PostgreSQL refuse une ligne résultante que les
 * politiques SELECT ne couvrent plus.
 *
 * L'objet reste dans le bucket : aucune politique DELETE n'y existe, délibérément.
 * Une pièce justificative ne quitte jamais le stockage par une requête applicative.
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
