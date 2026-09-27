import "server-only";

/**
 * Lectures d'occurrences.
 *
 * Couche data : elle traduit des requêtes en modèles, rien d'autre. Aucune règle
 * métier, aucune décision d'autorisation — la RLS filtre, les services décident.
 * Toute erreur PostgREST passe par mapPostgrestError().
 */

import { AppError, mapPostgrestError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  CursorPage,
  CursorParams,
  OccurrenceDetail,
  OccurrenceId,
  OccurrenceRow,
  OccurrenceWithType,
  ProfileId,
} from "@/types/domain";

/**
 * Colonnes listées explicitement, jamais `select('*')` : une colonne ajoutée en
 * base ne doit pas se mettre à traverser l'application sans que personne l'ait décidé.
 */
/**
 * ⚠️ Une seule chaîne littérale, sans concaténation : supabase-js dérive le type
 * du résultat de la valeur LITTÉRALE passée à `select()`. Un `"a" + "b"` produit
 * le type `string`, et tout le retour s'effondre en `GenericStringError`.
 */
const OCCURRENCE_COLUMNS =
  "id, entity_id, obligation_type_id, domain_id, period_key, period_start, period_end, event_date, expiry_date, legal_due_date, internal_due_date, status, owner_id, deputy_id, validator_id, commercial_register_id, rectifies_occurrence_id, rectification_index, started_at, submitted_for_validation_at, validated_at, validated_by, submitted_at, submitted_by, reference_number, na_reason, rejection_reason, late_reason, late_reason_code, penalty_incurred, penalty_note, is_locked, locked_at, locked_by, version, created_at, updated_at, deleted_at";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export interface OccurrenceListFilters {
  readonly status?: OccurrenceRow["status"] | undefined;
  readonly domainId?: string | undefined;
  readonly ownerId?: ProfileId | undefined;
  readonly periodKey?: string | undefined;
  readonly dueBefore?: string | undefined;
}

/**
 * Curseur opaque `legal_due_date|id`. Encodé pour décourager sa fabrication à la
 * main : il n'a pas vocation à être interprété côté client.
 */
interface DecodedCursor {
  readonly dueDate: string;
  readonly id: string;
}

function encodeCursor(row: Pick<OccurrenceRow, "legal_due_date" | "id">): string {
  return Buffer.from(`${row.legal_due_date}|${row.id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): DecodedCursor | null {
  try {
    const [dueDate, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    if (dueDate === undefined || id === undefined || id.length === 0) return null;
    return { dueDate, id };
  } catch {
    return null;
  }
}

export async function getOccurrenceById(id: OccurrenceId): Promise<Result<OccurrenceRow>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("obligation_occurrences")
    .select(OCCURRENCE_COLUMNS)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error !== null) return err(mapPostgrestError(error));
  // Absent et interdit sont indistinguables : la RLS a déjà filtré, et la réponse
  // ne doit pas révéler l'existence d'un dossier d'un autre domaine.
  if (data === null) return err(AppError.notFound("occurrence", id));

  return ok(data);
}

/**
 * Liste paginée par curseur. Jamais d'OFFSET : sur un tri par échéance, une
 * occurrence qui change d'état entre deux pages ferait sauter ou répéter des lignes.
 */
export async function listOccurrences(
  filters: OccurrenceListFilters = {},
  page: CursorParams = {},
): Promise<Result<CursorPage<OccurrenceWithType>>> {
  const supabase = await createSupabaseServerClient();
  const limit = Math.min(Math.max(page.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);

  let query = supabase
    .from("obligation_occurrences")
    .select(
      "id, entity_id, obligation_type_id, domain_id, period_key, period_start, period_end, event_date, expiry_date, legal_due_date, internal_due_date, status, owner_id, deputy_id, validator_id, commercial_register_id, rectifies_occurrence_id, rectification_index, started_at, submitted_for_validation_at, validated_at, validated_by, submitted_at, submitted_by, reference_number, na_reason, rejection_reason, late_reason, late_reason_code, penalty_incurred, penalty_note, is_locked, locked_at, locked_by, version, created_at, updated_at, deleted_at, obligation_types!inner(id, code, name, periodicity, criticality, domain_id, domains(id, code, label))",
    )
    .is("deleted_at", null)
    .order("legal_due_date", { ascending: true })
    .order("id", { ascending: true })
    // Une ligne de plus que demandé : sa présence indique qu'une page suivante existe,
    // sans nécessiter un COUNT sur toute la table.
    .limit(limit + 1);

  if (filters.status !== undefined) query = query.eq("status", filters.status);
  if (filters.ownerId !== undefined) query = query.eq("owner_id", filters.ownerId);
  if (filters.periodKey !== undefined) query = query.eq("period_key", filters.periodKey);
  if (filters.dueBefore !== undefined) query = query.lte("legal_due_date", filters.dueBefore);
  if (filters.domainId !== undefined) {
    query = query.eq("obligation_types.domain_id", filters.domainId);
  }

  if (page.cursor !== undefined && page.cursor.length > 0) {
    const decoded = decodeCursor(page.cursor);
    if (decoded === null) {
      return err(AppError.validationFailed({ cursor: "CURSOR_MALFORMED" }));
    }
    query = query.or(
      `legal_due_date.gt.${decoded.dueDate},and(legal_due_date.eq.${decoded.dueDate},id.gt.${decoded.id})`,
    );
  }

  const { data, error } = await query;
  if (error !== null) return err(mapPostgrestError(error));

  const rows = data;
  const hasMore = rows.length > limit;
  const visible = hasMore ? rows.slice(0, limit) : rows;

  const items: OccurrenceWithType[] = visible.map((row) => {
    const { obligation_types: joined, ...occurrence } = row;
    const { domains: joinedDomain, ...obligationType } = joined;
    return { occurrence, obligationType, domain: joinedDomain };
  });

  const last = items.at(-1);
  return ok({
    items,
    nextCursor: hasMore && last !== undefined ? encodeCursor(last.occurrence) : null,
  });
}

/** Chargement complet du dossier, en une passe : l'écran de détail n'en fait qu'un. */
export async function getOccurrenceDetail(id: OccurrenceId): Promise<Result<OccurrenceDetail>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("obligation_occurrences")
    // Colonnes listées jusque dans les jointures imbriquées : `*` est proscrit
    // partout (CLAUDE.md §6), y compris là où il serait commode.
    .select(
      "id, entity_id, obligation_type_id, domain_id, period_key, period_start, period_end, event_date, expiry_date, legal_due_date, internal_due_date, status, owner_id, deputy_id, validator_id, commercial_register_id, rectifies_occurrence_id, rectification_index, started_at, submitted_for_validation_at, validated_at, validated_by, submitted_at, submitted_by, reference_number, na_reason, rejection_reason, late_reason, late_reason_code, penalty_incurred, penalty_note, is_locked, locked_at, locked_by, version, created_at, updated_at, deleted_at, obligation_types!inner(id, entity_id, code, name, domain_id, authority_id, periodicity, due_rule, internal_lead_days, procedure_md, legal_basis, portal_url, default_owner_id, default_deputy_id, default_validator_id, scope, criticality, requires_validation, validation_levels, requires_proof, allow_self_validation, depends_on_obligation_type_id, generation_horizon_months, retention_years, effective_from, effective_to, is_active, created_by, created_at, updated_by, updated_at, deleted_at, domains(id, code, label), authorities(id, code, name, portal_url)), owner:profiles!obligation_occurrences_owner_id_fkey(id, full_name), validator:profiles!obligation_occurrences_validator_id_fkey(id, full_name), occurrence_checklist_items(id, occurrence_id, required_document_id, label, is_mandatory, document_kind, is_checked, checked_by, checked_at, order_index, created_at), documents(id, entity_id, occurrence_id, checklist_item_id, bucket, storage_path, original_filename, normalized_filename, mime_type, detected_mime_type, size_bytes, sha256, integrity_checked_at, integrity_status, version, supersedes_id, document_kind, uploaded_by, uploaded_at, deleted_at, deleted_by, deletion_reason, archived_offline_at, archived_in_backup_id), occurrence_transitions(id, occurrence_id, from_status, to_status, actor_id, on_behalf_of_id, acted_as, reason, metadata, created_at)",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error !== null) return err(mapPostgrestError(error));
  if (data === null) return err(AppError.notFound("occurrence", id));

  const {
    obligation_types: joinedType,
    owner,
    validator,
    occurrence_checklist_items: checklist,
    documents,
    occurrence_transitions: transitions,
    ...occurrence
  } = data;

  const { domains: domain, authorities: authority, ...obligationType } = joinedType;

  return ok({
    occurrence,
    obligationType,
    domain,
    authority,
    owner,
    validator,
    checklist: checklist,
    documents: documents,
    transitions: transitions,
  });
}

/** Compte les occurrences ouvertes d'un utilisateur — prérequis de la désactivation. */
export async function countOpenOccurrencesFor(userId: ProfileId): Promise<Result<number>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("open_occurrence_count", {
    p_user_id: userId,
  });

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data);
}
