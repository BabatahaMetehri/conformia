import "server-only";

/**
 * Lectures de pièces, et émission d'URL signées.
 *
 * Le stockage n'est atteignable que d'ici : c'est encore un client Supabase, il
 * relève donc de la couche data au même titre qu'une requête SQL.
 */

import { AppError, mapPostgrestError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DocumentId } from "@/types/domain";

/** Chaîne littérale unique : supabase-js type le résultat depuis cette valeur. */
const DOCUMENT_COLUMNS =
  "id, entity_id, occurrence_id, checklist_item_id, bucket, storage_path, original_filename, normalized_filename, mime_type, detected_mime_type, size_bytes, sha256, integrity_checked_at, version, supersedes_id, document_kind, uploaded_by, uploaded_at, deleted_at, deleted_by, deletion_reason";

export interface StoredDocument {
  readonly id: DocumentId;
  readonly bucket: string;
  readonly storagePath: string;
  readonly normalizedFilename: string;
  readonly originalFilename: string;
  readonly mimeType: string;
}

export async function getDocumentById(id: DocumentId): Promise<Result<StoredDocument>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("documents")
    .select(DOCUMENT_COLUMNS)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error !== null) return err(mapPostgrestError(error));
  // La RLS a déjà filtré : « absent » et « interdit » sont volontairement
  // indistinguables, la réponse ne doit pas révéler l'existence de la pièce.
  if (data === null) return err(AppError.notFound("document", id));

  return ok({
    id: data.id as DocumentId,
    bucket: data.bucket,
    storagePath: data.storage_path,
    normalizedFilename: data.normalized_filename,
    originalFilename: data.original_filename,
    mimeType: data.mime_type,
  });
}

export async function listDocumentsForOccurrence(
  occurrenceId: string,
): Promise<Result<readonly StoredDocument[]>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("documents")
    .select(DOCUMENT_COLUMNS)
    .eq("occurrence_id", occurrenceId)
    .is("deleted_at", null)
    .order("uploaded_at", { ascending: false });

  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      id: row.id as DocumentId,
      bucket: row.bucket,
      storagePath: row.storage_path,
      normalizedFilename: row.normalized_filename,
      originalFilename: row.original_filename,
      mimeType: row.mime_type,
    })),
  );
}

/** Durée de vie d'une URL signée, lue en base. Repli sur 300 s. */
export async function getSignedUrlTtlSeconds(): Promise<Result<number>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "signed_url_ttl_seconds")
    .maybeSingle();

  if (error !== null) return err(mapPostgrestError(error));

  const raw: unknown = data?.value;
  return ok(typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : 300);
}

export async function createSignedUrl(
  document: StoredDocument,
  ttlSeconds: number,
  asAttachment: boolean,
): Promise<Result<string>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.storage
    .from(document.bucket)
    .createSignedUrl(
      document.storagePath,
      ttlSeconds,
      asAttachment ? { download: document.normalizedFilename } : undefined,
    );

  if (error !== null) return err(AppError.storageFailed("create-signed-url", { cause: error }));
  return ok(data.signedUrl);
}

// ─── Contexte de dépôt ───────────────────────────────────────────────────────

export interface DepositContext {
  readonly entityCode: string;
  readonly domainCode: string;
  readonly obligationCode: string;
  readonly periodKey: string;
  readonly isLocked: boolean;
  readonly bytesAlreadyStored: number;
}

/**
 * Éléments nécessaires à la construction du chemin de stockage.
 *
 * ⚠️ Tous viennent de la BASE, aucun du client : le chemin d'un objet ne doit
 * jamais dépendre d'une valeur que le navigateur a pu choisir.
 */
export async function getDepositContext(occurrenceId: string): Promise<Result<DepositContext>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("obligation_occurrences")
    .select(
      "id, period_key, is_locked, entities(code), obligation_types!inner(code, domains(code))",
    )
    .eq("id", occurrenceId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error !== null) return err(mapPostgrestError(error));
  if (data === null) return err(AppError.notFound("occurrence", occurrenceId));

  const stored = await sumStoredBytes(occurrenceId);
  if (!stored.ok) return stored;

  return ok({
    entityCode: data.entities.code,
    domainCode: data.obligation_types.domains?.code ?? "domaine",
    obligationCode: data.obligation_types.code,
    periodKey: data.period_key,
    isLocked: data.is_locked,
    bytesAlreadyStored: stored.value,
  });
}

/** Volume déjà stocké sur le dossier — borne MAX_OCCURRENCE_TOTAL_MB. */
async function sumStoredBytes(occurrenceId: string): Promise<Result<number>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("documents")
    .select("size_bytes")
    .eq("occurrence_id", occurrenceId)
    .is("deleted_at", null);

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data.reduce((total, row) => total + row.size_bytes, 0));
}

/**
 * Version suivante pour une pièce attendue.
 *
 * On ne remplace jamais un fichier en place : la « nouvelle version » est un
 * nouvel objet qui pointe vers l'ancien. Le numéro se déduit donc de ce qui
 * existe déjà, pièces retirées comprises — repartir à v1 après une suppression
 * ferait réapparaître un nom déjà utilisé.
 */
export async function getSupersedeTarget(
  occurrenceId: string,
  checklistItemId: string | null,
): Promise<Result<{ readonly version: number; readonly supersedesId: string | null }>> {
  const supabase = await createSupabaseServerClient();

  const query = supabase
    .from("documents")
    .select("id, version, deleted_at")
    .eq("occurrence_id", occurrenceId)
    .order("version", { ascending: false })
    .limit(1);

  const { data, error } =
    checklistItemId === null
      ? await query.is("checklist_item_id", null)
      : await query.eq("checklist_item_id", checklistItemId);

  if (error !== null) return err(mapPostgrestError(error));

  const previous = data.at(0);
  if (previous === undefined) return ok({ version: 1, supersedesId: null });

  return ok({
    version: previous.version + 1,
    // Une pièce retirée ne se « remplace » pas : la chaîne de version repart sans
    // pointer vers elle, mais sans réutiliser son numéro.
    supersedesId: previous.deleted_at === null ? previous.id : null,
  });
}
