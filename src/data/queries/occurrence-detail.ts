import "server-only";

/**
 * Lectures de la fiche d'occurrence.
 *
 * L'agrégat principal tient en UNE requête : PostgREST imbrique la liste de
 * contrôle, les pièces, le journal d'état et la discussion dans la même réponse.
 * Le reste — périodes précédentes, rectificatives, audit, dépendance — se charge
 * en parallèle. Deux allers-retours au total, budget 300 ms tenu avec de la marge.
 *
 * ⚠️ Colonnes explicites jusque dans les imbrications : `*` est proscrit partout
 * (CLAUDE.md §6), y compris là où il serait commode.
 */

import { AppError, mapPostgrestError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Criticality, OccurrenceStatus, Periodicity } from "@/config/constants";
import type { OccurrenceId } from "@/types/domain";

/**
 * ⚠️ UNE chaîne littérale, sans concaténation : supabase-js dérive le type du
 * résultat de la valeur littérale. Un `"a" + "b"` produit `string`, et tout le
 * retour s'effondre en `GenericStringError`.
 */
const DETAIL_SELECT =
  "id, entity_id, obligation_type_id, domain_id, period_key, period_start, period_end, event_date, expiry_date, legal_due_date, internal_due_date, status, owner_id, deputy_id, validator_id, commercial_register_id, rectifies_occurrence_id, rectification_index, started_at, submitted_for_validation_at, validated_at, validated_by, submitted_at, submitted_by, reference_number, na_reason, rejection_reason, late_reason, late_reason_code, penalty_incurred, penalty_note, is_locked, locked_at, locked_by, version, created_at, updated_at, obligation_types!inner(id, code, name, domain_id, authority_id, periodicity, criticality, internal_lead_days, procedure_md, legal_basis, portal_url, requires_validation, requires_proof, depends_on_obligation_type_id, domains(id, code, label), authorities(id, code, name, portal_url)), owner:profiles!obligation_occurrences_owner_id_fkey(id, full_name), deputy:profiles!obligation_occurrences_deputy_id_fkey(id, full_name), validator:profiles!obligation_occurrences_validator_id_fkey(id, full_name), occurrence_checklist_items(id, required_document_id, label, is_mandatory, document_kind, is_checked, checked_at, order_index), documents(id, occurrence_id, checklist_item_id, original_filename, normalized_filename, mime_type, size_bytes, sha256, version, supersedes_id, document_kind, uploaded_at, uploaded_by, uploader:profiles!documents_uploaded_by_fkey(id, full_name)), occurrence_transitions(id, from_status, to_status, reason, metadata, created_at, acted_as, actor:profiles!occurrence_transitions_actor_id_fkey(id, full_name), on_behalf_of:profiles!occurrence_transitions_on_behalf_of_id_fkey(id, full_name)), occurrence_comments(id, body, mentioned_user_ids, created_at, updated_at, author_id, author:profiles!occurrence_comments_author_id_fkey(id, full_name))";

const SIBLING_SELECT =
  "id, period_key, period_start, status, legal_due_date, internal_due_date, rectification_index, rectifies_occurrence_id";

export type OccurrenceDetailRow = NonNullable<
  Awaited<ReturnType<typeof loadOccurrenceAggregate>> extends Result<infer T> ? T : never
>;

async function loadOccurrenceAggregate(id: OccurrenceId) {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("obligation_occurrences")
    .select(DETAIL_SELECT)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error !== null) return err(mapPostgrestError(error));
  // Absent et interdit sont volontairement indistinguables : la RLS a déjà filtré,
  // et l'écart de message permettrait d'énumérer les dossiers des autres domaines.
  if (data === null) return err(AppError.notFound("occurrence", id));

  return ok(data);
}

export interface SiblingOccurrence {
  readonly id: string;
  readonly periodKey: string;
  readonly periodStart: string;
  readonly status: OccurrenceStatus;
  readonly legalDueDate: string;
  readonly internalDueDate: string;
  readonly rectificationIndex: number;
  readonly rectifiesOccurrenceId: string | null;
}

/** Rectificatives d'une occurrence : lien inverse de rectifies_occurrence_id. */
export async function listRectifications(
  id: OccurrenceId,
): Promise<Result<readonly SiblingOccurrence[]>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("obligation_occurrences")
    .select(SIBLING_SELECT)
    .eq("rectifies_occurrence_id", id)
    .is("deleted_at", null)
    .order("rectification_index", { ascending: true });

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data.map(toSibling));
}

export async function getSiblingById(id: string): Promise<Result<SiblingOccurrence | null>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("obligation_occurrences")
    .select(SIBLING_SELECT)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data === null ? null : toSibling(data));
}

/**
 * Périodes précédentes de la MÊME obligation.
 *
 * Répond à l'exigence « historique des déclarations précédentes » : la question
 * posée devant un dossier en cours est presque toujours « comment a-t-on fait la
 * dernière fois ». Exclut la période courante et les rectificatives, qui ont
 * leur propre bandeau.
 */
export async function listPreviousOccurrences(
  obligationTypeId: string,
  currentPeriodKey: string,
  limit: number,
): Promise<Result<readonly SiblingOccurrence[]>> {
  const supabase = await createSupabaseServerClient();

  // ⚠️ Le tri et la borne portent sur period_key, non sur period_start. La clé de
  // période est conçue lisible ET triable (2026-01, 2026-Q1, 2026) : à périodicité
  // constante — ce qui est le cas au sein d'une même obligation — l'ordre
  // lexicographique EST l'ordre chronologique. Une rectificative « 2026-01-R1 »
  // trie après « 2026-01 » et se trouve donc écartée de la période courante,
  // exactement comme voulu : elle a son propre bandeau.
  const { data, error } = await supabase
    .from("obligation_occurrences")
    .select(SIBLING_SELECT)
    .eq("obligation_type_id", obligationTypeId)
    .lt("period_key", currentPeriodKey)
    .is("deleted_at", null)
    .order("period_key", { ascending: false })
    .limit(limit);

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data.map(toSibling));
}

function toSibling(row: {
  id: string;
  period_key: string;
  period_start: string;
  status: OccurrenceStatus;
  legal_due_date: string;
  internal_due_date: string;
  rectification_index: number;
  rectifies_occurrence_id: string | null;
}): SiblingOccurrence {
  return {
    id: row.id,
    periodKey: row.period_key,
    periodStart: row.period_start,
    status: row.status,
    legalDueDate: row.legal_due_date,
    internalDueDate: row.internal_due_date,
    rectificationIndex: row.rectification_index,
    rectifiesOccurrenceId: row.rectifies_occurrence_id,
  };
}

export interface DependencyState {
  readonly obligationTypeId: string;
  readonly obligationCode: string;
  readonly obligationName: string;
  readonly dependencyOccurrenceId: string | null;
  readonly periodKey: string | null;
  readonly status: OccurrenceStatus | null;
}

/** Dépendance déclarée au référentiel, et état de son occurrence la plus proche. */
export async function getDependencyState(
  id: OccurrenceId,
): Promise<Result<DependencyState | null>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("occurrence_dependency_state", {
    p_occurrence_id: id,
  });

  if (error !== null) return err(mapPostgrestError(error));

  const row = data.at(0);
  if (row === undefined) return ok(null);

  return ok({
    obligationTypeId: row.obligation_type_id,
    obligationCode: row.obligation_code,
    obligationName: row.obligation_name,
    dependencyOccurrenceId: row.dependency_occurrence_id,
    periodKey: row.period_key,
    status: row.status,
  });
}

export interface OccurrenceAuditRow {
  readonly id: string;
  readonly action: string;
  readonly entityTable: string;
  readonly actorEmail: string | null;
  readonly changedFields: readonly string[];
  readonly occurredAt: string;
}

/**
 * Entrées d'audit du dossier.
 *
 * `entity_id_ref` porte l'identifiant de la LIGNE auditée : les pièces et les
 * commentaires du dossier ont le leur, ils ne remontent donc pas ici. La fiche
 * fusionne ensuite les trois sources dans une chronologie unique.
 */
export async function listOccurrenceAuditEntries(
  id: OccurrenceId,
  limit = 100,
): Promise<Result<readonly OccurrenceAuditRow[]>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("audit_log")
    .select("id, action, entity_table, actor_email, changed_fields, occurred_at")
    .eq("entity_table", "obligation_occurrences")
    .eq("entity_id_ref", id)
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      id: String(row.id),
      action: row.action,
      entityTable: row.entity_table,
      actorEmail: row.actor_email,
      changedFields: row.changed_fields ?? [],
      occurredAt: row.occurred_at,
    })),
  );
}

export interface TransitionOption {
  readonly toStatus: OccurrenceStatus;
  readonly requiredPermission: string;
  readonly requiresReason: boolean;
  readonly label: string;
}

/**
 * Transitions ouvertes depuis un statut.
 *
 * ⚠️ Lues en BASE, jamais écrites en dur. La barre d'actions n'est donc pas une
 * seconde définition du cycle de vie : elle affiche ce que la table autorise, et
 * une transition ajoutée demain apparaît sans redéploiement (CLAUDE.md §3.5).
 */
export async function listTransitionsFrom(
  status: OccurrenceStatus,
): Promise<Result<readonly TransitionOption[]>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("status_transition_rules")
    .select("to_status, required_permission, requires_reason, label")
    .eq("from_status", status);

  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      toStatus: row.to_status,
      requiredPermission: row.required_permission,
      requiresReason: row.requires_reason,
      label: row.label,
    })),
  );
}

export type { Criticality, OccurrenceStatus, Periodicity };
export { loadOccurrenceAggregate };

/**
 * La base décide-t-elle que l'appelant peut valider CE dossier ?
 *
 * ⚠️ Appel direct à la fonction que le trigger de transition consulte lui-même.
 * Réimplémenter la séparation des tâches côté interface produirait deux règles
 * condamnées à diverger : le bouton finirait par s'afficher là où la base refuse,
 * ou l'inverse. Une requête de plus vaut mieux qu'une seconde vérité.
 */
export async function canValidateOccurrence(id: OccurrenceId): Promise<Result<boolean>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("can_validate_occurrence", {
    occurrence_id: id,
  });

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data);
}

/**
 * La séparation des tâches interdit-elle à l'appelant de valider CE dossier ?
 *
 * Même prédicat que le trigger qui refuse : `self_validation_blocked()` est
 * partagée entre les deux. Le bouton « Valider » ne peut donc pas promettre ce
 * que la base refusera trois lignes plus loin.
 */
export async function isSelfValidationBlocked(id: OccurrenceId): Promise<Result<boolean>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("self_validation_blocked_for", {
    p_occurrence_id: id,
  });

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data);
}

export interface TransitionContext {
  readonly status: OccurrenceStatus;
  readonly version: number;
  readonly isLocked: boolean;
}

/** État courant du dossier, avant d'en demander le changement. */
export async function getTransitionContext(id: OccurrenceId): Promise<Result<TransitionContext>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("obligation_occurrences")
    .select("status, version, is_locked")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error !== null) return err(mapPostgrestError(error));
  if (data === null) return err(AppError.notFound("occurrence", id));

  return ok({ status: data.status, version: data.version, isLocked: data.is_locked });
}

/**
 * Règle de la transition demandée, ou `null` si elle n'existe pas.
 *
 * ⚠️ La permission exigée est LUE ICI, jamais écrite dans le code de l'action.
 * Une Server Action qui vérifierait « occurrence.submit » en dur deviendrait une
 * seconde définition du cycle de vie, condamnée à diverger de la table.
 */
export async function getTransitionRule(
  fromStatus: OccurrenceStatus,
  toStatus: OccurrenceStatus,
): Promise<Result<TransitionOption | null>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("status_transition_rules")
    .select("to_status, required_permission, requires_reason, label")
    .eq("from_status", fromStatus)
    .eq("to_status", toStatus)
    .maybeSingle();

  if (error !== null) return err(mapPostgrestError(error));
  if (data === null) return ok(null);

  return ok({
    toStatus: data.to_status,
    requiredPermission: data.required_permission,
    requiresReason: data.requires_reason,
    label: data.label,
  });
}
