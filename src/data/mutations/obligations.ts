import "server-only";

/**
 * Écritures du référentiel des obligations.
 *
 * Toutes ces écritures déclenchent `audit_trigger()` : acteur, avant, après et
 * champs modifiés sont journalisés par la base, pas par la discipline de
 * l'appelant (cf. CLAUDE.md §3.6).
 */

import { AppError, mapPostgrestError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database.types";
import type { ObligationTypeId, ObligationTypeRow, RequiredDocumentRow } from "@/types/domain";

export interface ObligationWritePayload {
  readonly code: string;
  readonly name: string;
  readonly domain_id: string | null;
  readonly authority_id: string | null;
  readonly periodicity: ObligationTypeRow["periodicity"];
  readonly due_rule: Json;
  readonly internal_lead_days: number;
  readonly procedure_md: string | null;
  readonly legal_basis: string | null;
  readonly portal_url: string | null;
  readonly default_owner_id: string | null;
  readonly default_validator_id: string | null;
  readonly criticality: ObligationTypeRow["criticality"];
  readonly requires_validation: boolean;
  readonly validation_levels: number;
  readonly requires_proof: boolean;
  readonly allow_self_validation: boolean;
  readonly depends_on_obligation_type_id: string | null;
  readonly generation_horizon_months: number;
  readonly retention_years: number;
  readonly effective_from: string;
  readonly effective_to: string | null;
}

export interface RequiredDocumentPayload {
  readonly id?: string | undefined;
  readonly label: string;
  readonly description: string | null;
  readonly is_mandatory: boolean;
  readonly document_kind: string | null;
  readonly max_size_mb: number;
}

export async function insertObligationType(
  payload: ObligationWritePayload,
  actorId: string,
): Promise<Result<ObligationTypeRow>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("obligation_types")
    .insert({ ...payload, created_by: actorId, updated_by: actorId })
    .select(
      "id, entity_id, code, name, domain_id, authority_id, periodicity, due_rule, internal_lead_days, procedure_md, legal_basis, portal_url, default_owner_id, default_deputy_id, default_validator_id, scope, criticality, requires_validation, validation_levels, requires_proof, allow_self_validation, depends_on_obligation_type_id, generation_horizon_months, retention_years, effective_from, effective_to, is_active, created_by, created_at, updated_by, updated_at, deleted_at",
    )
    .single();

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data);
}

export async function updateObligationTypeRow(
  id: ObligationTypeId,
  payload: ObligationWritePayload,
  actorId: string,
): Promise<Result<ObligationTypeRow>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("obligation_types")
    .update({ ...payload, updated_by: actorId, updated_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select(
      "id, entity_id, code, name, domain_id, authority_id, periodicity, due_rule, internal_lead_days, procedure_md, legal_basis, portal_url, default_owner_id, default_deputy_id, default_validator_id, scope, criticality, requires_validation, validation_levels, requires_proof, allow_self_validation, depends_on_obligation_type_id, generation_horizon_months, retention_years, effective_from, effective_to, is_active, created_by, created_at, updated_by, updated_at, deleted_at",
    )
    .maybeSingle();

  if (error !== null) return err(mapPostgrestError(error));
  if (data === null) return err(AppError.notFound("obligation_type", id));
  return ok(data);
}

export async function setObligationActive(
  id: ObligationTypeId,
  isActive: boolean,
  actorId: string,
): Promise<Result<ObligationTypeRow>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("obligation_types")
    .update({ is_active: isActive, updated_by: actorId, updated_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select(
      "id, entity_id, code, name, domain_id, authority_id, periodicity, due_rule, internal_lead_days, procedure_md, legal_basis, portal_url, default_owner_id, default_deputy_id, default_validator_id, scope, criticality, requires_validation, validation_levels, requires_proof, allow_self_validation, depends_on_obligation_type_id, generation_horizon_months, retention_years, effective_from, effective_to, is_active, created_by, created_at, updated_by, updated_at, deleted_at",
    )
    .maybeSingle();

  if (error !== null) return err(mapPostgrestError(error));
  if (data === null) return err(AppError.notFound("obligation_type", id));
  return ok(data);
}

/**
 * Remplace la liste des pièces requises.
 *
 * Suppression puis réinsertion, et non un différentiel ligne à ligne. La
 * contrainte `unique (obligation_type_id, order_index)` rend toute réorganisation
 * incrémentale conflictuelle : permuter deux pièces exige un rang temporaire que
 * la contrainte refuse. C'est la seule table du référentiel réellement
 * supprimable — elle ne décrit qu'une attente, elle ne porte aucun dossier.
 */
export async function replaceRequiredDocuments(
  obligationTypeId: ObligationTypeId,
  documents: readonly RequiredDocumentPayload[],
): Promise<Result<readonly RequiredDocumentRow[]>> {
  const supabase = await createSupabaseServerClient();

  const { error: deleteError } = await supabase
    .from("obligation_required_documents")
    .delete()
    .eq("obligation_type_id", obligationTypeId);

  if (deleteError !== null) return err(mapPostgrestError(deleteError));
  if (documents.length === 0) return ok([]);

  // `order_index` vient de la POSITION, jamais d'une saisie : deux pièces au
  // même rang buteraient sur la contrainte unique, et l'utilisateur verrait une
  // erreur technique pour un glisser-déposer qui semblait légitime.
  const rows = documents.map((document, index) => ({
    obligation_type_id: obligationTypeId,
    label: document.label,
    description: document.description,
    is_mandatory: document.is_mandatory,
    document_kind: document.document_kind,
    max_size_mb: document.max_size_mb,
    order_index: index,
  }));

  const { data, error } = await supabase
    .from("obligation_required_documents")
    .insert(rows)
    .select(
      "id, obligation_type_id, label, description, is_mandatory, document_kind, accepted_mime_types, max_size_mb, order_index, created_at",
    );

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data);
}

export interface DueDateUpdate {
  readonly occurrence_id: string;
  readonly legal_due_date: string;
  readonly internal_due_date: string;
}

/**
 * Applique le recalcul aux occurrences TODO.
 *
 * ⚠️ Passe par `recalculate_todo_due_dates()`, SECURITY DEFINER borné : aucun
 * UPDATE direct n'est possible ici, `occurrence.write` n'appartenant à aucun
 * porteur de `referential.manage`. Les bornes (TODO seulement, non verrouillée,
 * même obligation) sont posées EN BASE, pas dans ce module — un appelant qui
 * enverrait d'autres identifiants n'obtiendrait rien.
 */
export async function applyDueDateRecalculation(
  obligationTypeId: ObligationTypeId,
  updates: readonly DueDateUpdate[],
): Promise<Result<number>> {
  if (updates.length === 0) return ok(0);

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("recalculate_todo_due_dates", {
    p_obligation_type_id: obligationTypeId,
    p_updates: updates as unknown as never,
  });

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data);
}

/** Suppression LOGIQUE. Le trigger refuse si des dossiers vivants subsistent. */
export async function softDeleteObligationType(
  id: ObligationTypeId,
  actorId: string,
): Promise<Result<ObligationTypeRow>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("obligation_types")
    .update({
      deleted_at: new Date().toISOString(),
      is_active: false,
      updated_by: actorId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .is("deleted_at", null)
    .select(
      "id, entity_id, code, name, domain_id, authority_id, periodicity, due_rule, internal_lead_days, procedure_md, legal_basis, portal_url, default_owner_id, default_deputy_id, default_validator_id, scope, criticality, requires_validation, validation_levels, requires_proof, allow_self_validation, depends_on_obligation_type_id, generation_horizon_months, retention_years, effective_from, effective_to, is_active, created_by, created_at, updated_by, updated_at, deleted_at",
    )
    .maybeSingle();

  if (error !== null) return err(mapPostgrestError(error));
  if (data === null) return err(AppError.notFound("obligation_type", id));
  return ok(data);
}
