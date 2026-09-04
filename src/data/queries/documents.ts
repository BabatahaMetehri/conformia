import "server-only";

/**
 * Lectures de pièces, émission d'URL signées, et relecture d'en-tête.
 *
 * Le stockage n'est atteignable que d'ici : c'est encore un client Supabase, il
 * relève donc de la couche data au même titre qu'une requête SQL.
 */

import { HEADER_SNIFF_BYTES, sanitizeDownloadFilename } from "@/lib/files";
import { AppError, mapPostgrestError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DocumentId } from "@/types/domain";

/** Chaîne littérale unique : supabase-js type le résultat depuis cette valeur. */
const DOCUMENT_COLUMNS =
  "id, entity_id, occurrence_id, checklist_item_id, bucket, storage_path, original_filename, normalized_filename, mime_type, detected_mime_type, size_bytes, sha256, integrity_checked_at, integrity_status, version, supersedes_id, document_kind, uploaded_by, uploaded_at, deleted_at, deleted_by, deletion_reason";

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

  // ⚠️ Le nom voyage jusqu'à un en-tête `Content-Disposition`. Il est produit par
  // `buildNormalizedFilename` et ne peut donc pas porter de retour chariot —
  // raison de plus pour ne pas s'en remettre à cette propriété : elle est vraie
  // tant que personne n'introduit un chemin où le nom d'origine ressortirait tel
  // quel. Un `\r\n` dans un nom de fichier permet d'injecter un en-tête entier.
  const { data, error } = await supabase.storage
    .from(document.bucket)
    .createSignedUrl(
      document.storagePath,
      ttlSeconds,
      asAttachment
        ? { download: sanitizeDownloadFilename(document.normalizedFilename) }
        : undefined,
    );

  if (error !== null) return err(AppError.storageFailed("create-signed-url", { cause: error }));
  return ok(data.signedUrl);
}

// ─── Relecture d'en-tête ─────────────────────────────────────────────────────

export interface ObjectHead {
  readonly bytes: Uint8Array;
  readonly totalSize: number;
}

/**
 * Premiers octets de l'objet RÉELLEMENT stocké, et sa taille réelle.
 *
 * ⚠️ C'est le seul endroit où le serveur applicatif touche au contenu d'une
 * pièce, et il n'en lit que l'en-tête — quelques kilo-octets, pas le fichier.
 * L'interdiction du §2 porte sur le TRANSIT du fichier ; vérifier la signature
 * de ce qui a été écrit suppose de regarder les octets écrits, et les regarder
 * ailleurs que dans le stockage reviendrait à croire le navigateur sur parole.
 *
 * La lecture se fait sur l'objet stocké et non sur ce que le client prétend
 * avoir envoyé : c'est la différence entre une vérification et une formalité.
 * Un client peut annoncer un PDF, faire valider un en-tête PDF, puis téléverser
 * un exécutable — seule la relecture d'après stockage l'attrape.
 */
export async function fetchObjectHead(bucket: string, path: string): Promise<Result<ObjectHead>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60);
  if (error !== null) {
    return err(AppError.storageFailed("create-signed-url-head", { cause: error }));
  }

  const response = await fetch(data.signedUrl, {
    headers: { Range: `bytes=0-${String(HEADER_SNIFF_BYTES - 1)}` },
    cache: "no-store",
  });

  if (!response.ok) {
    return err(AppError.storageFailed("read-head", { details: { status: response.status } }));
  }

  const bytes = new Uint8Array(await response.arrayBuffer());

  // `Content-Range: bytes 0-4095/12345` porte la taille totale. Sans en-tête de
  // plage — objet plus court que la fenêtre demandée — la taille lue EST la taille.
  const contentRange = response.headers.get("content-range");
  const total = contentRange?.split("/").at(-1);
  const parsed = total === undefined ? Number.NaN : Number.parseInt(total, 10);

  return ok({
    bytes,
    totalSize: Number.isInteger(parsed) && parsed >= 0 ? parsed : bytes.length,
  });
}

// ─── Billets de dépôt ────────────────────────────────────────────────────────

export interface UploadTicket {
  readonly id: string;
  readonly occurrenceId: string;
  readonly bucket: string;
  readonly storagePath: string;
  readonly originalFilename: string;
  readonly declaredMimeType: string;
  readonly declaredSizeBytes: number;
}

export async function getUploadTicket(ticketId: string): Promise<Result<UploadTicket>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("document_upload_tickets")
    .select(
      "id, occurrence_id, bucket, storage_path, original_filename, declared_mime_type, declared_size_bytes, consumed_at, rejected_at, expires_at",
    )
    .eq("id", ticketId)
    .maybeSingle();

  if (error !== null) return err(mapPostgrestError(error));
  // La politique de lecture ne rend que ses PROPRES billets : un identifiant
  // deviné ne renseigne donc sur rien.
  if (data === null) return err(AppError.notFound("upload-ticket", ticketId));

  return ok({
    id: data.id,
    occurrenceId: data.occurrence_id,
    bucket: data.bucket,
    storagePath: data.storage_path,
    originalFilename: data.original_filename,
    declaredMimeType: data.declared_mime_type,
    declaredSizeBytes: data.declared_size_bytes,
  });
}

// ─── Contexte de nommage ─────────────────────────────────────────────────────

export interface NamingContext {
  readonly obligationCode: string;
  readonly periodKey: string;
  readonly pieceLabel: string | null;
  readonly documentKind: string | null;
}

/**
 * Éléments du nom normalisé, tous lus EN BASE.
 *
 * ⚠️ Le libellé de la pièce et sa nature viennent de la ligne de liste de
 * contrôle, jamais du formulaire. La version précédente de ce flux acceptait un
 * `pieceLabel` envoyé par le navigateur : le nom de la pièce déposée était donc
 * en partie choisi par le client. Il ne l'est plus.
 */
export async function getNamingContext(
  occurrenceId: string,
  checklistItemId: string | null,
): Promise<Result<NamingContext>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("obligation_occurrences")
    .select("id, period_key, obligation_types!inner(code)")
    .eq("id", occurrenceId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error !== null) return err(mapPostgrestError(error));
  if (data === null) return err(AppError.notFound("occurrence", occurrenceId));

  if (checklistItemId === null) {
    return ok({
      obligationCode: data.obligation_types.code,
      periodKey: data.period_key,
      pieceLabel: null,
      documentKind: null,
    });
  }

  const item = await supabase
    .from("occurrence_checklist_items")
    .select("id, label, document_kind, occurrence_id")
    .eq("id", checklistItemId)
    .eq("occurrence_id", occurrenceId)
    .maybeSingle();

  if (item.error !== null) return err(mapPostgrestError(item.error));
  if (item.data === null) return err(AppError.notFound("checklist-item", checklistItemId));

  return ok({
    obligationCode: data.obligation_types.code,
    periodKey: data.period_key,
    pieceLabel: item.data.label,
    documentKind: item.data.document_kind,
  });
}

// ─── Recherche transverse ────────────────────────────────────────────────────

const SEARCH_COLUMNS =
  "id, occurrence_id, checklist_item_id, original_filename, normalized_filename, mime_type, size_bytes, sha256, version, supersedes_id, document_kind, uploaded_at, uploaded_by, integrity_status, integrity_checked_at, uploader_name, period_key, period_start, obligation_type_id, obligation_code, obligation_name, obligation_scope, commercial_register_id, register_number, domain_id, domain_code, authority_id, authority_name, is_current_version";

export interface DocumentSearchFilters {
  /** Fiche d'une pièce : filtre le plus étroit, tout le reste est ignoré. */
  readonly documentId?: string | undefined;
  readonly occurrenceId?: string | undefined;
  readonly checklistItemId?: string | null | undefined;
  readonly search?: string | undefined;
  readonly obligationTypeId?: string | undefined;
  readonly authorityId?: string | undefined;
  readonly documentKind?: string | undefined;
  readonly uploadedBy?: string | undefined;
  readonly periodKey?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly currentOnly?: boolean | undefined;
  /**
   * Registre de commerce.
   *
   * ⚠️ INCLUSIF : « ce registre OU toute l'entreprise ». /documents est un écran
   * de CONSULTATION — la question posée est « qu'est-ce qui concerne cet
   * établissement ? », et les pièces d'une déclaration valant pour toute
   * l'entreprise le concernent aussi. Les masquer donnerait de l'établissement
   * une image faussement dégarnie.
   */
  readonly registerId?: string | undefined;
  readonly limit: number;
  readonly offset: number;
}

export interface DocumentSearchRow {
  readonly id: string;
  readonly occurrenceId: string;
  readonly checklistItemId: string | null;
  readonly sha256: string;
  readonly originalFilename: string;
  readonly normalizedFilename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly version: number;
  readonly documentKind: string | null;
  readonly uploadedAt: string;
  readonly uploaderName: string | null;
  readonly integrityStatus: string;
  readonly integrityCheckedAt: string | null;
  readonly periodKey: string;
  readonly obligationCode: string;
  readonly obligationName: string;
  readonly authorityName: string | null;
  readonly isCurrentVersion: boolean;
  /** `ENTITY` ou `PER_REGISTER` — porte la mention « toute l'entreprise ». */
  readonly obligationScope: string;
  readonly registerNumber: string | null;
}

export interface DocumentSearchPage {
  readonly rows: readonly DocumentSearchRow[];
  readonly total: number;
}

export async function searchDocuments(
  filters: DocumentSearchFilters,
): Promise<Result<DocumentSearchPage>> {
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("documents_search")
    .select(SEARCH_COLUMNS, { count: "exact" })
    .order("uploaded_at", { ascending: false })
    .range(filters.offset, filters.offset + filters.limit - 1);

  if (filters.documentId !== undefined) query = query.eq("id", filters.documentId);
  if (filters.occurrenceId !== undefined) query = query.eq("occurrence_id", filters.occurrenceId);
  if (filters.checklistItemId !== undefined) {
    query =
      filters.checklistItemId === null
        ? query.is("checklist_item_id", null)
        : query.eq("checklist_item_id", filters.checklistItemId);
  }

  const term = filters.search?.trim();
  if (term !== undefined && term.length > 0) {
    // `%` et `,` ont un sens dans la grammaire PostgREST : les neutraliser évite
    // qu'une saisie ne se transforme en filtre supplémentaire.
    query = query.ilike("search_text", `%${term.replace(/[%,]/g, " ")}%`);
  }
  if (filters.obligationTypeId !== undefined) {
    query = query.eq("obligation_type_id", filters.obligationTypeId);
  }
  if (filters.authorityId !== undefined) query = query.eq("authority_id", filters.authorityId);
  if (filters.documentKind !== undefined) query = query.eq("document_kind", filters.documentKind);
  if (filters.uploadedBy !== undefined) query = query.eq("uploaded_by", filters.uploadedBy);
  if (filters.periodKey !== undefined) query = query.eq("period_key", filters.periodKey);
  if (filters.from !== undefined) query = query.gte("uploaded_at", filters.from);
  if (filters.to !== undefined) query = query.lte("uploaded_at", filters.to);
  if (filters.currentOnly === true) query = query.eq("is_current_version", true);
  if (filters.registerId !== undefined) {
    // Voir le commentaire du champ : la forme inclusive est délibérée.
    query = query.or(`commercial_register_id.eq.${filters.registerId},obligation_scope.eq.ENTITY`);
  }

  const { data, error, count } = await query;
  if (error !== null) return err(mapPostgrestError(error));

  return ok({
    total: count ?? 0,
    rows: data.map((row) => ({
      id: row.id ?? "",
      occurrenceId: row.occurrence_id ?? "",
      checklistItemId: row.checklist_item_id,
      sha256: row.sha256 ?? "",
      originalFilename: row.original_filename ?? "",
      normalizedFilename: row.normalized_filename ?? "",
      mimeType: row.mime_type ?? "",
      sizeBytes: row.size_bytes ?? 0,
      version: row.version ?? 1,
      documentKind: row.document_kind,
      uploadedAt: row.uploaded_at ?? "",
      uploaderName: row.uploader_name,
      integrityStatus: row.integrity_status ?? "PENDING",
      integrityCheckedAt: row.integrity_checked_at,
      periodKey: row.period_key ?? "",
      obligationCode: row.obligation_code ?? "",
      obligationName: row.obligation_name ?? "",
      authorityName: row.authority_name,
      isCurrentVersion: row.is_current_version ?? true,
      obligationScope: row.obligation_scope ?? "ENTITY",
      registerNumber: row.register_number,
    })),
  });
}

// ─── Fiche d'une pièce ───────────────────────────────────────────────────────

export interface DocumentAccessEntry {
  readonly id: number;
  readonly action: string;
  readonly actorName: string | null;
  readonly createdAt: string;
}

export async function listDocumentAccessLog(
  documentId: string,
  limit = 50,
): Promise<Result<readonly DocumentAccessEntry[]>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("document_access_log")
    .select("id, action, actor_id, created_at")
    .eq("document_id", documentId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error !== null) return err(mapPostgrestError(error));

  // ⚠️ Deux requêtes, faute de clé étrangère vers `profiles` — et cette absence
  // est VOULUE (cf. 0003) : la trace d'un accès doit survivre à la suppression du
  // compte qui l'a produit. Un embed PostgREST exigerait la relation, donc la
  // contrainte, donc le couplage qu'on a refusé. Le nom est joint ici, et une
  // ligne dont l'auteur a disparu reste une ligne.
  const actorIds = [
    ...new Set(data.flatMap((row) => (row.actor_id === null ? [] : [row.actor_id]))),
  ];
  const names = new Map<string, string>();

  if (actorIds.length > 0) {
    const profiles = await supabase.from("profiles").select("id, full_name").in("id", actorIds);
    if (profiles.error !== null) return err(mapPostgrestError(profiles.error));
    for (const profile of profiles.data) {
      // Un profil sans nom reste un profil : on le laisse hors table plutôt que
      // d'inscrire une chaîne vide, que l'affichage prendrait pour un nom.
      if (profile.full_name !== null) names.set(profile.id, profile.full_name);
    }
  }

  return ok(
    data.map((row) => ({
      id: row.id,
      action: row.action,
      actorName: row.actor_id === null ? null : (names.get(row.actor_id) ?? null),
      createdAt: row.created_at,
    })),
  );
}

export interface IntegrityCheckEntry {
  readonly id: number;
  readonly status: string;
  readonly checkedAt: string;
  readonly actualSha256: string | null;
  readonly acknowledgedAt: string | null;
}

export async function listIntegrityChecks(
  documentId: string,
  limit = 10,
): Promise<Result<readonly IntegrityCheckEntry[]>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("document_integrity_checks")
    .select("id, status, checked_at, actual_sha256, acknowledged_at")
    .eq("document_id", documentId)
    .order("checked_at", { ascending: false })
    .limit(limit);

  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      id: row.id,
      status: row.status,
      checkedAt: row.checked_at,
      actualSha256: row.actual_sha256,
      acknowledgedAt: row.acknowledged_at,
    })),
  );
}

export interface IntegrityAlertRow {
  readonly id: number;
  readonly documentId: string;
  readonly status: string;
  readonly checkedAt: string;
  readonly originalFilename: string;
  readonly obligationCode: string;
  readonly periodKey: string;
}

export async function listIntegrityAlerts(
  limit = 100,
): Promise<Result<readonly IntegrityAlertRow[]>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("document_integrity_alerts")
    .select("id, document_id, status, checked_at, original_filename, obligation_code, period_key")
    .order("checked_at", { ascending: false })
    .limit(limit);

  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      id: row.id ?? 0,
      documentId: row.document_id ?? "",
      status: row.status ?? "MISMATCH",
      checkedAt: row.checked_at ?? "",
      originalFilename: row.original_filename ?? "",
      obligationCode: row.obligation_code ?? "",
      periodKey: row.period_key ?? "",
    })),
  );
}

// ─── File de purge ───────────────────────────────────────────────────────────

export interface PurgeCandidateRow {
  readonly id: string;
  readonly occurrenceId: string;
  readonly originalFilename: string;
  readonly normalizedFilename: string;
  readonly uploadedAt: string;
  readonly retentionYears: number;
  readonly purgeEligibleOn: string;
  readonly obligationCode: string;
  readonly periodKey: string;
}

export async function listPurgeCandidates(
  limit = 200,
): Promise<Result<readonly PurgeCandidateRow[]>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("documents_pending_purge")
    .select(
      "id, occurrence_id, original_filename, normalized_filename, uploaded_at, retention_years, purge_eligible_on, obligation_code, period_key",
    )
    .order("purge_eligible_on", { ascending: true })
    .limit(limit);

  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      id: row.id ?? "",
      occurrenceId: row.occurrence_id ?? "",
      originalFilename: row.original_filename ?? "",
      normalizedFilename: row.normalized_filename ?? "",
      uploadedAt: row.uploaded_at ?? "",
      retentionYears: row.retention_years ?? 0,
      purgeEligibleOn: row.purge_eligible_on ?? "",
      obligationCode: row.obligation_code ?? "",
      periodKey: row.period_key ?? "",
    })),
  );
}
