import "server-only";

/**
 * Lectures et journalisation des exports.
 *
 * ⚠️ DEUX CHEMINS, ET LA DIFFÉRENCE EST TOUT LE SUJET :
 *
 *  • `loadMyExportScope` s'exécute dans la SESSION de l'appelant et interroge la
 *    façade sans argument. L'utilisateur exporte ce qu'il voit, sans qu'aucune
 *    ligne de TypeScript n'ait à le décider.
 *  • `loadExportScopeFor` prend un profil en argument et n'est joignable qu'avec
 *    la clé de service. Elle sert à l'export ASYNCHRONE, qui n'a plus de session
 *    — et c'est précisément là qu'un export pourrait cesser d'être cloisonné.
 *    Le périmètre reste celui du DEMANDEUR, jamais celui de la tâche.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { mapPostgrestError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/database.types";

export type ExportClient = SupabaseClient<Database>;

type Enums = Database["public"]["Enums"];
export type ExportKind = Enums["export_kind"];
export type ExportFormat = Enums["export_format"];
export type ExportStatus = Enums["export_status"];

/** Une occurrence telle qu'elle sort du périmètre exportable. */
export interface ExportableOccurrence {
  readonly occurrenceId: string;
  readonly obligationCode: string;
  readonly obligationName: string;
  readonly domainCode: string;
  readonly authorityName: string | null;
  readonly periodKey: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly legalDueDate: string;
  readonly internalDueDate: string;
  readonly status: Enums["occurrence_status"];
  readonly criticality: Enums["criticality"];
  readonly ownerName: string | null;
  readonly validatorName: string | null;
  readonly submittedAt: string | null;
  readonly lateReasonCode: Enums["late_reason_code"] | null;
  readonly lateReason: string | null;
  readonly lateDays: number | null;
  readonly documentCount: number;
}

interface ScopeRow {
  occurrence_id: string;
  obligation_code: string;
  obligation_name: string;
  domain_code: string;
  authority_name: string | null;
  period_key: string;
  period_start: string;
  period_end: string;
  legal_due_date: string;
  internal_due_date: string;
  status: Enums["occurrence_status"];
  criticality: Enums["criticality"];
  owner_name: string | null;
  validator_name: string | null;
  submitted_at: string | null;
  late_reason_code: Enums["late_reason_code"] | null;
  late_reason: string | null;
  late_days: number | null;
  document_count: number;
}

function toOccurrence(row: ScopeRow): ExportableOccurrence {
  return {
    occurrenceId: row.occurrence_id,
    obligationCode: row.obligation_code,
    obligationName: row.obligation_name,
    domainCode: row.domain_code,
    authorityName: row.authority_name,
    periodKey: row.period_key,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    legalDueDate: row.legal_due_date,
    internalDueDate: row.internal_due_date,
    status: row.status,
    criticality: row.criticality,
    ownerName: row.owner_name,
    validatorName: row.validator_name,
    submittedAt: row.submitted_at,
    lateReasonCode: row.late_reason_code,
    lateReason: row.late_reason,
    lateDays: row.late_days,
    documentCount: row.document_count,
  };
}

export interface ExportScopeFilters {
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly domainId?: string | undefined;
  readonly authorityId?: string | undefined;
}

function scopeArgs(filters: ExportScopeFilters): Record<string, string> {
  // Les arguments absents sont OMIS : les paramètres SQL portent un défaut NULL,
  // et `exactOptionalPropertyTypes` refuse un `undefined` explicite.
  return {
    ...(filters.from === undefined ? {} : { p_from: filters.from }),
    ...(filters.to === undefined ? {} : { p_to: filters.to }),
    ...(filters.domainId === undefined ? {} : { p_domain: filters.domainId }),
    ...(filters.authorityId === undefined ? {} : { p_authority: filters.authorityId }),
  };
}

/** Périmètre de l'appelant. Le profil vient de la session, jamais du client. */
export async function loadMyExportScope(
  filters: ExportScopeFilters,
): Promise<Result<readonly ExportableOccurrence[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("my_exportable_occurrences", scopeArgs(filters));

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data.map(toOccurrence));
}

/** Périmètre d'un profil DONNÉ. Réservé aux tâches de fond. */
export async function loadExportScopeFor(
  client: ExportClient,
  userId: string,
  filters: ExportScopeFilters,
): Promise<Result<readonly ExportableOccurrence[]>> {
  const { data, error } = await client.rpc("exportable_occurrences", {
    p_user: userId,
    ...scopeArgs(filters),
  });

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data.map(toOccurrence));
}

// ─── Journal des exports ─────────────────────────────────────────────────────

export interface StartExportInput {
  readonly kind: ExportKind;
  readonly format: ExportFormat;
  readonly scope: Record<string, Json>;
  readonly isAsync?: boolean;
}

export async function startExportRun(input: StartExportInput): Promise<Result<string>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("start_export_run", {
    p_kind: input.kind,
    p_format: input.format,
    p_scope: input.scope,
    ...(input.isAsync === undefined ? {} : { p_is_async: input.isAsync }),
  });

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data);
}

export interface FinishExportInput {
  readonly runId: string;
  readonly status: ExportStatus;
  readonly occurrences: number;
  readonly documents: number;
  readonly sizeBytes: number;
  readonly fileName: string;
  readonly error?: string | undefined;
}

export async function finishExportRun(input: FinishExportInput): Promise<Result<void>> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("finish_export_run", {
    p_run: input.runId,
    p_status: input.status,
    p_occurrences: input.occurrences,
    p_documents: input.documents,
    p_size_bytes: input.sizeBytes,
    p_file_name: input.fileName,
    ...(input.error === undefined ? {} : { p_error: input.error }),
  });

  if (error !== null) return err(mapPostgrestError(error));
  return ok(undefined);
}

/** Trace l'export dans le journal d'audit — en plus de `export_runs`. */
export async function logExport(
  kind: ExportKind,
  entityTable: string,
  entityId: string | null,
  detail: Record<string, Json>,
): Promise<Result<void>> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("log_export", {
    p_kind: kind,
    p_entity_table: entityTable,
    p_detail: detail,
    ...(entityId === null ? {} : { p_entity_id: entityId }),
  });

  if (error !== null) return err(mapPostgrestError(error));
  return ok(undefined);
}

export interface ExportRunView {
  readonly id: string;
  readonly kind: ExportKind;
  readonly format: ExportFormat;
  readonly status: ExportStatus;
  readonly scope: Record<string, Json>;
  readonly occurrenceCount: number;
  readonly documentCount: number;
  readonly sizeBytes: number | null;
  readonly fileName: string | null;
  readonly isAsync: boolean;
  readonly requestedBy: string;
  readonly requestedByName: string | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly errorMessage: string | null;
}

/*
 * ⚠️ AUCUNE JOINTURE vers `profiles`, et ce n'est pas un choix de style.
 *
 * La clé étrangère `export_runs_requested_by_fkey` pointe vers DEUX relations —
 * la table `profiles` et la vue `profile_directory` — et le générateur de types
 * Supabase ne sait alors pas laquelle décrire : l'imbrication compile en
 * `GenericStringError`, un type d'erreur, alors que la requête fonctionne
 * parfaitement à l'exécution. Plutôt que de forcer le type par un `as`, on
 * résout les noms en une seconde lecture : deux requêtes bornées valent mieux
 * qu'une assertion qui masque un vrai flou du schéma.
 */
/*
 * ⚠️ UN SEUL LITTÉRAL, jamais une concaténation.
 *
 * Le typage de `supabase-js` analyse la chaîne de sélection À LA COMPILATION pour
 * en déduire la forme des lignes. TypeScript ne replie pas `"a" + "b"` en type
 * littéral : la chaîne concaténée s'élargit en `string`, l'analyse échoue, et
 * chaque ligne devient `GenericStringError` — une erreur de type sur une requête
 * pourtant parfaitement valide à l'exécution. D'où la ligne longue, comme
 * partout ailleurs dans cette couche.
 */
const RUN_COLUMNS =
  "id, kind, format, status, scope, occurrence_count, document_count, size_bytes, file_name, is_async, requested_by, started_at, finished_at, error_message";

/** Historique visible de l'appelant : les siens, plus tout pour `audit.read`. */
export async function listExportRuns(limit: number): Promise<Result<readonly ExportRunView[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("export_runs")
    .select(RUN_COLUMNS)
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error !== null) return err(mapPostgrestError(error));

  const authorIds = [...new Set(data.map((row) => row.requested_by))];
  const names = new Map<string, string | null>();

  if (authorIds.length > 0) {
    const { data: authors, error: authorError } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", authorIds);

    // Un nom manquant n'empêche pas de lire l'historique : la ligne reste, sans
    // son auteur nommé. L'identifiant, lui, est déjà dans la colonne.
    if (authorError === null) {
      for (const author of authors) names.set(author.id, author.full_name);
    }
  }

  return ok(
    data.map((row) => ({
      id: row.id,
      kind: row.kind,
      format: row.format,
      status: row.status,
      scope: (row.scope ?? {}) as Record<string, Json>,
      occurrenceCount: row.occurrence_count,
      documentCount: row.document_count,
      sizeBytes: row.size_bytes,
      fileName: row.file_name,
      isAsync: row.is_async,
      requestedBy: row.requested_by,
      requestedByName: names.get(row.requested_by) ?? null,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      errorMessage: row.error_message,
    })),
  );
}

// ─── Pièces d'un dossier ─────────────────────────────────────────────────────

export interface ExportableDocument {
  readonly id: string;
  readonly bucket: string;
  readonly storagePath: string;
  readonly normalizedFilename: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly version: number;
  readonly checklistOrder: number | null;
  readonly checklistLabel: string | null;
  readonly documentKind: string | null;
  readonly uploadedAt: string;
}

/** Un seul littéral — voir RUN_COLUMNS pour la raison. */
const DOCUMENT_COLUMNS =
  "id, bucket, storage_path, normalized_filename, sha256, size_bytes, version, document_kind, uploaded_at, occurrence_checklist_items(order_index, label)";

/**
 * Pièces attachées à une occurrence.
 *
 * ⚠️ Lues DANS LA SESSION : la politique RLS de `documents` s'applique. Un
 * utilisateur qui ne voit pas l'occurrence n'obtient aucune ligne, et l'archive
 * qu'il télécharge est vide plutôt qu'indûment garnie.
 */
export async function listOccurrenceDocuments(
  occurrenceId: string,
): Promise<Result<readonly ExportableDocument[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("documents")
    .select(DOCUMENT_COLUMNS)
    .eq("occurrence_id", occurrenceId)
    .is("deleted_at", null)
    .order("uploaded_at");

  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      id: row.id,
      bucket: row.bucket,
      storagePath: row.storage_path,
      normalizedFilename: row.normalized_filename,
      sha256: row.sha256,
      sizeBytes: row.size_bytes,
      version: row.version,
      checklistOrder: row.occurrence_checklist_items?.order_index ?? null,
      checklistLabel: row.occurrence_checklist_items?.label ?? null,
      documentKind: row.document_kind,
      uploadedAt: row.uploaded_at,
    })),
  );
}

/**
 * Flux d'octets d'une pièce.
 *
 * ⚠️ Rend un `ReadableStream`, jamais un tampon. Une archive de dossier peut
 * contenir vingt-cinq mégaoctets par pièce : les charger toutes en mémoire pour
 * les recompresser ensuite ferait tomber le serveur sur un export d'exercice.
 */
export async function openDocumentStream(
  bucket: string,
  storagePath: string,
): Promise<Result<ReadableStream<Uint8Array>>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.storage.from(bucket).download(storagePath);

  if (error !== null) {
    return err(
      mapPostgrestError({ code: "STORAGE", message: error.message, details: "", hint: "" }),
    );
  }

  return ok(data.stream() as ReadableStream<Uint8Array>);
}

/**
 * Faits de dépôt d'une occurrence, absents de la vue de détail.
 *
 * La fiche récapitulative doit dire quand le dossier a été déposé et avec quel
 * retard ; la vue d'écran, elle, n'en a pas l'usage et ne les porte pas.
 */
export interface SubmissionFacts {
  readonly submittedAt: string | null;
  readonly lateDays: number | null;
}

export async function loadSubmissionFacts(occurrenceId: string): Promise<Result<SubmissionFacts>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("obligation_occurrences")
    .select("submitted_at, legal_due_date")
    .eq("id", occurrenceId)
    .single();

  if (error !== null) return err(mapPostgrestError(error));
  if (data.submitted_at === null) return ok({ submittedAt: null, lateDays: null });

  // Retard compté sur l'échéance LÉGALE, en jours civils d'Alger : c'est la
  // seule mesure qu'un organisme reconnaît.
  const submitted = new Date(data.submitted_at);
  const localDay = new Date(submitted.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);
  const difference = Math.round(
    (Date.parse(`${localDay}T00:00:00Z`) - Date.parse(`${data.legal_due_date}T00:00:00Z`)) /
      86_400_000,
  );

  return ok({ submittedAt: data.submitted_at, lateDays: Math.max(difference, 0) });
}

/**
 * Pièces d'une occurrence, lues AVEC LA CLÉ DE SERVICE.
 *
 * ⚠️ Réservée à l'export asynchrone, et sûre à une condition : la liste des
 * occurrences lui est fournie par `loadExportScopeFor`, déjà bornée au périmètre
 * du DEMANDEUR. La tâche ne choisit donc jamais elle-même ce qu'elle lit — elle
 * ne fait que descendre dans des dossiers dont l'accès a déjà été tranché.
 */
export async function listOccurrenceDocumentsAs(
  client: ExportClient,
  occurrenceId: string,
): Promise<Result<readonly ExportableDocument[]>> {
  const { data, error } = await client
    .from("documents")
    .select(DOCUMENT_COLUMNS)
    .eq("occurrence_id", occurrenceId)
    .is("deleted_at", null)
    .order("uploaded_at");

  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      id: row.id,
      bucket: row.bucket,
      storagePath: row.storage_path,
      normalizedFilename: row.normalized_filename,
      sha256: row.sha256,
      sizeBytes: row.size_bytes,
      version: row.version,
      checklistOrder: row.occurrence_checklist_items?.order_index ?? null,
      checklistLabel: row.occurrence_checklist_items?.label ?? null,
      documentKind: row.document_kind,
      uploadedAt: row.uploaded_at,
    })),
  );
}

/** Flux d'une pièce, avec la clé de service. Même réserve que ci-dessus. */
export async function openDocumentStreamAs(
  client: ExportClient,
  bucket: string,
  storagePath: string,
): Promise<Result<ReadableStream<Uint8Array>>> {
  const { data, error } = await client.storage.from(bucket).download(storagePath);
  if (error !== null) {
    return err(
      mapPostgrestError({ code: "STORAGE", message: error.message, details: "", hint: "" }),
    );
  }
  return ok(data.stream() as ReadableStream<Uint8Array>);
}

/** Demandes d'export asynchrone en attente, pour la tâche de fond. */
export interface PendingAsyncExport {
  readonly id: string;
  readonly requestedBy: string;
  readonly kind: ExportKind;
  readonly format: ExportFormat;
  readonly scope: Record<string, Json>;
}

export async function listPendingAsyncExports(
  client: ExportClient,
  limit: number,
): Promise<Result<readonly PendingAsyncExport[]>> {
  const { data, error } = await client.rpc("pending_async_exports", { p_limit: limit });
  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      id: row.id,
      requestedBy: row.requested_by,
      kind: row.kind,
      format: row.format,
      scope: (row.scope ?? {}) as Record<string, Json>,
    })),
  );
}

/** Clôt un export asynchrone ET prévient son auteur. */
export async function finishAsyncExport(
  client: ExportClient,
  input: FinishExportInput,
): Promise<Result<void>> {
  const { error } = await client.rpc("finish_async_export", {
    p_run: input.runId,
    p_status: input.status,
    p_occurrences: input.occurrences,
    p_documents: input.documents,
    p_size_bytes: input.sizeBytes,
    p_file_name: input.fileName,
    ...(input.error === undefined ? {} : { p_error: input.error }),
  });

  if (error !== null) return err(mapPostgrestError(error));
  return ok(undefined);
}

/** Dépose l'archive produite dans le bucket privé des exports. */
export async function uploadExportArtifact(
  client: ExportClient,
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<Result<void>> {
  const { error } = await client.storage.from("exports").upload(path, bytes, {
    contentType,
    upsert: true,
  });

  if (error !== null) {
    return err(
      mapPostgrestError({ code: "STORAGE", message: error.message, details: "", hint: "" }),
    );
  }
  return ok(undefined);
}

// ─── Rectificatives et chronologie ───────────────────────────────────────────

export interface RectificationRef {
  readonly id: string;
  readonly index: number;
  readonly periodKey: string;
  readonly status: Enums["occurrence_status"];
}

export async function listRectifications(
  occurrenceId: string,
): Promise<Result<readonly RectificationRef[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("obligation_occurrences")
    .select("id, rectification_index, period_key, status")
    .eq("rectifies_occurrence_id", occurrenceId)
    .is("deleted_at", null)
    .order("rectification_index");

  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      id: row.id,
      index: row.rectification_index,
      periodKey: row.period_key,
      status: row.status,
    })),
  );
}

export interface HistoryRow {
  readonly occurredAt: string;
  readonly source: "TRANSITION" | "AUDIT";
  readonly actor: string | null;
  readonly onBehalfOf: string | null;
  readonly action: string;
  readonly fromStatus: string | null;
  readonly toStatus: string | null;
  readonly reason: string | null;
}

/**
 * Chronologie complète : transitions d'état ET actions d'audit.
 *
 * Les deux sources, parce qu'elles ne disent pas la même chose. Les transitions
 * racontent l'avancement du dossier ; l'audit raconte tout le reste — dépôts de
 * pièces, réaffectations, consultations. Un historique amputé de l'un des deux
 * laisse un contrôleur avec des trous qu'il devra faire combler.
 */
export async function loadHistory(occurrenceId: string): Promise<Result<readonly HistoryRow[]>> {
  const supabase = await createSupabaseServerClient();

  const [transitions, audit] = await Promise.all([
    supabase
      .from("occurrence_transitions")
      // ⚠️ `created_at`, pas `occurred_at` : c'est le nom de la colonne dans
      // `occurrence_transitions`. Seul `audit_log` horodate en `occurred_at`.
      .select(
        "created_at, from_status, to_status, reason, actor:profiles!occurrence_transitions_actor_id_fkey(full_name), behalf:profiles!occurrence_transitions_on_behalf_of_id_fkey(full_name)",
      )
      .eq("occurrence_id", occurrenceId)
      .order("created_at"),
    supabase
      .from("audit_log")
      .select("occurred_at, action, actor_email, entity_table")
      .eq("entity_id_ref", occurrenceId)
      .order("occurred_at"),
  ]);

  if (transitions.error !== null) return err(mapPostgrestError(transitions.error));
  if (audit.error !== null) return err(mapPostgrestError(audit.error));

  const rows: HistoryRow[] = [
    ...transitions.data.map((row) => ({
      occurredAt: row.created_at,
      source: "TRANSITION" as const,
      actor: row.actor?.full_name ?? null,
      onBehalfOf: row.behalf?.full_name ?? null,
      action: "TRANSITION",
      fromStatus: row.from_status,
      toStatus: row.to_status,
      reason: row.reason,
    })),
    ...audit.data.map((row) => ({
      occurredAt: row.occurred_at,
      source: "AUDIT" as const,
      actor: row.actor_email,
      onBehalfOf: null,
      action: row.action,
      fromStatus: null,
      toStatus: null,
      reason: row.entity_table,
    })),
  ];

  rows.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  return ok(rows);
}
