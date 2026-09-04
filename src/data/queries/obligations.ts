import "server-only";

/**
 * Lectures du référentiel des obligations.
 *
 * Couche data : elle traduit des requêtes en modèles. Aucune règle métier,
 * aucune décision d'autorisation — la RLS filtre, les services décident.
 */

import { AppError, mapPostgrestError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ObligationListFilters } from "@/services/obligations/schema";
import type {
  AuthorityRow,
  DomainRow,
  ObligationTypeId,
  ObligationTypeRow,
  OccurrenceRow,
  RequiredDocumentRow,
} from "@/types/domain";

/**
 * ⚠️ Une seule chaîne littérale, jamais de concaténation : supabase-js dérive le
 * type du résultat de la valeur LITTÉRALE passée à `select()`. Un `"a" + "b"`
 * produit le type `string`, et tout le retour s'effondre en `GenericStringError`.
 */
const OBLIGATION_COLUMNS =
  "id, entity_id, code, name, domain_id, authority_id, periodicity, due_rule, internal_lead_days, procedure_md, legal_basis, portal_url, default_owner_id, default_deputy_id, default_validator_id, scope, criticality, requires_validation, validation_levels, requires_proof, allow_self_validation, depends_on_obligation_type_id, generation_horizon_months, retention_years, effective_from, effective_to, is_active, created_by, created_at, updated_by, updated_at, deleted_at";

export interface ObligationListRow {
  readonly obligationType: ObligationTypeRow;
  readonly domain: Pick<DomainRow, "id" | "code" | "label"> | null;
  readonly authority: Pick<AuthorityRow, "id" | "code" | "name"> | null;
  readonly defaultOwnerName: string | null;
  /**
   * Prochaine échéance non close, ou `null`.
   *
   * ⚠️ `null` ne veut pas dire « aucune » : il veut dire « aucune VISIBLE ». La
   * RLS des occurrences cloisonne par domaine, un ADMIN verra donc toujours
   * `null` — ce qui est exactement le comportement voulu, pas une anomalie.
   */
  readonly nextDueDate: string | null;
}

export async function listObligationTypes(
  filters: ObligationListFilters = {},
): Promise<Result<readonly ObligationListRow[]>> {
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("obligation_types")
    .select(
      "id, entity_id, code, name, domain_id, authority_id, periodicity, due_rule, internal_lead_days, procedure_md, legal_basis, portal_url, default_owner_id, default_deputy_id, default_validator_id, scope, criticality, requires_validation, validation_levels, requires_proof, allow_self_validation, depends_on_obligation_type_id, generation_horizon_months, retention_years, effective_from, effective_to, is_active, created_by, created_at, updated_by, updated_at, deleted_at, domains(id, code, label), authorities(id, code, name), owner:profiles!obligation_types_default_owner_id_fkey(id, full_name)",
    )
    .is("deleted_at", null)
    .order("code", { ascending: true });

  if (filters.domain_id !== undefined) query = query.eq("domain_id", filters.domain_id);
  if (filters.authority_id !== undefined) query = query.eq("authority_id", filters.authority_id);
  if (filters.periodicity !== undefined) query = query.eq("periodicity", filters.periodicity);
  if (filters.criticality !== undefined) query = query.eq("criticality", filters.criticality);
  if (filters.is_active !== undefined) query = query.eq("is_active", filters.is_active);

  const { data, error } = await query;
  if (error !== null) return err(mapPostgrestError(error));

  const rows = data.map((row) => {
    const { domains, authorities, owner, ...obligationType } = row;
    return { obligationType, domain: domains, authority: authorities, owner };
  });

  const nextDueDates = await nextDueDateByObligation(rows.map((row) => row.obligationType.id));
  if (!nextDueDates.ok) return nextDueDates;

  return ok(
    rows.map((row) => ({
      obligationType: row.obligationType,
      domain: row.domain,
      authority: row.authority,
      defaultOwnerName: row.owner?.full_name ?? null,
      nextDueDate: nextDueDates.value.get(row.obligationType.id) ?? null,
    })),
  );
}

/**
 * Prochaine échéance ouverte par obligation, en UNE requête.
 *
 * Une sous-requête par ligne coûterait N allers-retours pour une colonne
 * d'affichage. On récupère les échéances ouvertes triées, et on retient la
 * première de chaque obligation.
 */
async function nextDueDateByObligation(
  obligationIds: readonly string[],
): Promise<Result<ReadonlyMap<string, string>>> {
  if (obligationIds.length === 0) return ok(new Map());

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("obligation_occurrences")
    .select("obligation_type_id, legal_due_date")
    .in("obligation_type_id", obligationIds as string[])
    .is("deleted_at", null)
    .not("status", "in", "(VALIDATED,SUBMITTED,ARCHIVED,NOT_APPLICABLE)")
    .order("legal_due_date", { ascending: true });

  if (error !== null) return err(mapPostgrestError(error));

  const nextByObligation = new Map<string, string>();
  for (const row of data) {
    if (!nextByObligation.has(row.obligation_type_id)) {
      nextByObligation.set(row.obligation_type_id, row.legal_due_date);
    }
  }
  return ok(nextByObligation);
}

/** Recherche plein texte sur code, nom, base légale et procédure. */
export async function searchObligationTypes(
  term: string,
  filters: ObligationListFilters = {},
): Promise<Result<readonly ObligationListRow[]>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("global_search", { p_query: term, p_limit: 20 });
  if (error !== null) return err(mapPostgrestError(error));

  const matchedIds = data.filter((row) => row.kind === "OBLIGATION").map((row) => row.result_id);

  if (matchedIds.length === 0) return ok([]);

  const all = await listObligationTypes(filters);
  if (!all.ok) return all;

  // L'ordre de pertinence de la recherche prime sur l'ordre alphabétique.
  const rank = new Map(matchedIds.map((id, index) => [id, index]));
  return ok(
    all.value
      .filter((row) => rank.has(row.obligationType.id))
      .sort(
        (left, right) =>
          (rank.get(left.obligationType.id) ?? 0) - (rank.get(right.obligationType.id) ?? 0),
      ),
  );
}

// ─── Détail ──────────────────────────────────────────────────────────────────

export interface ObligationDetailRow {
  readonly obligationType: ObligationTypeRow;
  readonly domain: DomainRow | null;
  readonly authority: Pick<AuthorityRow, "id" | "code" | "name" | "portal_url"> | null;
  readonly requiredDocuments: readonly RequiredDocumentRow[];
  readonly dependsOn: Pick<ObligationTypeRow, "id" | "code" | "name" | "is_active"> | null;
  readonly defaultOwnerName: string | null;
  readonly defaultDeputyName: string | null;
  readonly defaultValidatorName: string | null;
}

export async function getObligationType(
  id: ObligationTypeId,
): Promise<Result<ObligationDetailRow>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("obligation_types")
    .select(
      "id, entity_id, code, name, domain_id, authority_id, periodicity, due_rule, internal_lead_days, procedure_md, legal_basis, portal_url, default_owner_id, default_deputy_id, default_validator_id, scope, criticality, requires_validation, validation_levels, requires_proof, allow_self_validation, depends_on_obligation_type_id, generation_horizon_months, retention_years, effective_from, effective_to, is_active, created_by, created_at, updated_by, updated_at, deleted_at, domains(id, code, label), authorities(id, code, name, portal_url), obligation_required_documents(id, obligation_type_id, label, description, is_mandatory, document_kind, accepted_mime_types, max_size_mb, order_index, created_at), owner:profiles!obligation_types_default_owner_id_fkey(id, full_name), deputy:profiles!obligation_types_default_deputy_id_fkey(id, full_name), validator:profiles!obligation_types_default_validator_id_fkey(id, full_name)",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error !== null) return err(mapPostgrestError(error));
  // Absent et interdit sont indistinguables : la RLS a déjà filtré, et la
  // réponse ne doit pas révéler l'existence d'une obligation d'un autre domaine.
  if (data === null) return err(AppError.notFound("obligation_type", id));

  const {
    domains,
    authorities,
    obligation_required_documents: requiredDocuments,
    owner,
    deputy,
    validator,
    ...obligationType
  } = data;

  /*
   * L'obligation parente est lue à part, et non par une jointure imbriquée.
   * `obligation_types` se référence elle-même : supabase-js ne sait pas déduire
   * la cardinalité d'une relation réflexive et type le résultat en TABLEAU. Le
   * corriger par un `as` masquerait le problème au lieu de le résoudre — une
   * seconde requête, sur une clé primaire, coûte moins qu'une assertion fausse.
   */
  const dependsOn = await getObligationSummary(obligationType.depends_on_obligation_type_id);
  if (!dependsOn.ok) return dependsOn;

  return ok({
    obligationType,
    domain: domains,
    authority: authorities,
    requiredDocuments: [...requiredDocuments].sort((a, b) => a.order_index - b.order_index),
    dependsOn: dependsOn.value,
    defaultOwnerName: owner?.full_name ?? null,
    defaultDeputyName: deputy?.full_name ?? null,
    defaultValidatorName: validator?.full_name ?? null,
  });
}

async function getObligationSummary(
  id: string | null,
): Promise<Result<Pick<ObligationTypeRow, "id" | "code" | "name" | "is_active"> | null>> {
  if (id === null) return ok(null);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("obligation_types")
    .select("id, code, name, is_active")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data);
}

/** Occurrences déjà générées, pour l'onglet historique de la fiche. */
export async function listOccurrencesOfObligation(
  id: ObligationTypeId,
  limit = 60,
): Promise<Result<readonly OccurrenceRow[]>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("obligation_occurrences")
    .select(
      "id, entity_id, obligation_type_id, domain_id, period_key, period_start, period_end, event_date, expiry_date, legal_due_date, internal_due_date, status, owner_id, deputy_id, validator_id, commercial_register_id, rectifies_occurrence_id, rectification_index, started_at, submitted_for_validation_at, validated_at, validated_by, submitted_at, submitted_by, reference_number, na_reason, rejection_reason, late_reason, late_reason_code, penalty_incurred, penalty_note, is_locked, locked_at, locked_by, version, created_at, updated_at, deleted_at",
    )
    .eq("obligation_type_id", id)
    .is("deleted_at", null)
    .order("legal_due_date", { ascending: false })
    .limit(limit);

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data);
}

/**
 * Occurrences TODO recalculables.
 *
 * ⚠️ SECURITY INVOKER par nature : requête ordinaire, donc soumise à la RLS. Un
 * porteur de `referential.manage` sans accès au domaine obtient zéro ligne — ce
 * n'est pas un bug, c'est le cloisonnement. Le service le détecte en amont par
 * les permissions et le DIT à l'utilisateur, au lieu d'annoncer « 0 concernée ».
 */
export async function listRecalculableOccurrences(
  id: ObligationTypeId,
): Promise<Result<readonly OccurrenceRow[]>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("obligation_occurrences")
    .select(
      "id, entity_id, obligation_type_id, domain_id, period_key, period_start, period_end, event_date, expiry_date, legal_due_date, internal_due_date, status, owner_id, deputy_id, validator_id, commercial_register_id, rectifies_occurrence_id, rectification_index, started_at, submitted_for_validation_at, validated_at, validated_by, submitted_at, submitted_by, reference_number, na_reason, rejection_reason, late_reason, late_reason_code, penalty_incurred, penalty_note, is_locked, locked_at, locked_by, version, created_at, updated_at, deleted_at",
    )
    .eq("obligation_type_id", id)
    .eq("status", "TODO")
    .eq("is_locked", false)
    .is("deleted_at", null)
    .order("legal_due_date", { ascending: true });

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data);
}

// ─── Référentiels de saisie ──────────────────────────────────────────────────

export interface ObligationFormOptions {
  readonly domains: readonly Pick<DomainRow, "id" | "code" | "label">[];
  readonly authorities: readonly Pick<AuthorityRow, "id" | "code" | "name">[];
  readonly obligations: readonly Pick<ObligationTypeRow, "id" | "code" | "name">[];
  readonly holidays: readonly string[];
}

/** Tout ce dont le formulaire a besoin, en une passe. */
export async function getObligationFormOptions(): Promise<Result<ObligationFormOptions>> {
  const supabase = await createSupabaseServerClient();

  const [domains, authorities, obligations, holidays] = await Promise.all([
    supabase.from("domains").select("id, code, label").order("label"),
    supabase.from("authorities").select("id, code, name").order("name"),
    supabase.from("obligation_types").select("id, code, name").is("deleted_at", null).order("code"),
    supabase.from("holidays").select("holiday_date").order("holiday_date"),
  ]);

  if (domains.error !== null) return err(mapPostgrestError(domains.error));
  if (authorities.error !== null) return err(mapPostgrestError(authorities.error));
  if (obligations.error !== null) return err(mapPostgrestError(obligations.error));
  if (holidays.error !== null) return err(mapPostgrestError(holidays.error));

  return ok({
    domains: domains.data,
    authorities: authorities.data,
    obligations: obligations.data,
    holidays: holidays.data.map((row) => row.holiday_date),
  });
}

/** Vrai si une autre obligation ACTIVE dépend de celle-ci. */
export async function countActiveDependents(id: ObligationTypeId): Promise<Result<number>> {
  const supabase = await createSupabaseServerClient();

  const { count, error } = await supabase
    .from("obligation_types")
    .select("id", { count: "exact", head: true })
    .eq("depends_on_obligation_type_id", id)
    .eq("is_active", true)
    .is("deleted_at", null);

  if (error !== null) return err(mapPostgrestError(error));
  return ok(count ?? 0);
}

export interface ObligationAuditRow {
  readonly id: string;
  readonly action: string;
  readonly entityTable: string;
  readonly actorEmail: string | null;
  readonly changedFields: readonly string[];
  readonly occurredAt: string;
}

/**
 * Journal d'audit d'une obligation.
 *
 * Lecture soumise a la policy audit_log_select : sans audit.read, la requete
 * rend zero ligne. L'onglet le DIT plutot que d'afficher un historique vide,
 * qui laisserait croire qu'il ne s'est rien passe.
 */
export async function listObligationAuditEntries(
  id: ObligationTypeId,
  limit = 50,
): Promise<Result<readonly ObligationAuditRow[]>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("audit_log")
    .select("id, action, entity_table, actor_email, changed_fields, occurred_at")
    .eq("entity_table", "obligation_types")
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

export { OBLIGATION_COLUMNS };
