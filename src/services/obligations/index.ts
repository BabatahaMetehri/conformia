import "server-only";

/**
 * Référentiel des obligations — logique métier.
 *
 * ⚠️ AUCUN branchement sur un code d'obligation. G50, IBS et CNAS ne sont que
 * des lignes de données : ce module ne les connaît pas et ne doit jamais les
 * connaître (cf. CLAUDE.md §3.5). Ajouter une obligation ne demande aucun
 * déploiement.
 *
 * Toutes les fonctions rendent `Result<T, AppError>`. Les exceptions restent
 * réservées aux bugs de programmation.
 */

import { formatISO } from "date-fns";

import { Periodicity } from "@/config/constants";
import {
  countActiveDependents,
  getObligationFormOptions,
  getObligationType,
  listObligationTypes,
  listOccurrencesOfObligation,
  listRecalculableOccurrences,
  searchObligationTypes,
  type ObligationDetailRow,
  type ObligationListRow,
} from "@/data/queries/obligations";
import {
  applyDueDateRecalculation,
  insertObligationType,
  replaceRequiredDocuments,
  setObligationActive,
  softDeleteObligationType,
  updateObligationTypeRow,
  type DueDateUpdate,
  type ObligationWritePayload,
} from "@/data/mutations/obligations";
import { AppError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import {
  CreateObligationTypeSchema,
  ObligationListFiltersSchema,
  UpdateObligationTypeSchema,
  type CreateObligationTypeValues,
  type ObligationListFilters,
  type UpdateObligationTypeValues,
} from "@/services/obligations/schema";
import { requireAuthContext, requirePermission } from "@/services/auth/context";
import { computeDueDate, validateDueRule } from "@/services/scheduling";
import { toObligationTypeId, type ObligationTypeId, type OccurrenceRow } from "@/types/domain";

export * from "@/services/obligations/schema";

// ─── Lecture ─────────────────────────────────────────────────────────────────

export async function listObligations(
  rawFilters: unknown = {},
): Promise<Result<readonly ObligationListRow[]>> {
  const context = await requirePermission("obligation.read");
  if (!context.ok) return context;

  const parsed = ObligationListFiltersSchema.safeParse(rawFilters);
  if (!parsed.success) {
    return err(AppError.validationFailed({ reason: "FILTERS_MALFORMED" }));
  }

  const filters: ObligationListFilters = parsed.data;
  const term = filters.search;

  // La recherche plein texte prime : elle porte sur des colonnes que le filtrage
  // relationnel n'atteint pas (procédure, base légale).
  if (term !== undefined && term.length >= 2) {
    return searchObligationTypes(term, filters);
  }
  return listObligationTypes(filters);
}

export async function getObligation(id: string): Promise<Result<ObligationDetailRow>> {
  const context = await requirePermission("obligation.read");
  if (!context.ok) return context;

  return getObligationType(toObligationTypeId(id));
}

export async function listObligationOccurrences(
  id: string,
): Promise<Result<readonly OccurrenceRow[]>> {
  const context = await requirePermission("obligation.read");
  if (!context.ok) return context;

  return listOccurrencesOfObligation(toObligationTypeId(id));
}

export async function getFormOptions(): ReturnType<typeof getObligationFormOptions> {
  const context = await requirePermission("obligation.read");
  if (!context.ok) return context;

  return getObligationFormOptions();
}

// ─── Écriture ────────────────────────────────────────────────────────────────

function toWritePayload(
  values: CreateObligationTypeValues | UpdateObligationTypeValues,
): ObligationWritePayload {
  return {
    code: values.code,
    name: values.name,
    domain_id: values.domain_id,
    authority_id: values.authority_id,
    periodicity: values.periodicity,
    due_rule: values.due_rule,
    internal_lead_days: values.internal_lead_days,
    procedure_md: values.procedure_md,
    legal_basis: values.legal_basis,
    portal_url: values.portal_url,
    default_owner_id: values.default_owner_id,
    default_validator_id: values.default_validator_id,
    criticality: values.criticality,
    requires_validation: values.requires_validation,
    validation_levels: values.validation_levels,
    requires_proof: values.requires_proof,
    allow_self_validation: values.allow_self_validation,
    depends_on_obligation_type_id: values.depends_on_obligation_type_id,
    generation_horizon_months: values.generation_horizon_months,
    retention_years: values.retention_years,
    effective_from: values.effective_from,
    effective_to: values.effective_to,
  };
}

/**
 * Revalide la règle d'échéance CONTRE la périodicité choisie.
 *
 * Le schéma Zod valide la forme de `due_rule` isolément ; la cohérence
 * périodicité ↔ ancre demande les deux champs à la fois. On la rejoue ici, côté
 * serveur, même si le formulaire l'a déjà faite : la Server Action ne fait
 * aucune confiance à ce que le navigateur lui envoie.
 */
function checkRuleCoherence(
  values: CreateObligationTypeValues | UpdateObligationTypeValues,
): Result<null> {
  const validated = validateDueRule({
    rule: values.due_rule,
    periodicity: values.periodicity,
  });
  return validated.ok ? ok(null) : err(validated.error);
}

export async function createObligationType(
  input: unknown,
): Promise<Result<{ readonly id: string }>> {
  const context = await requirePermission("referential.manage");
  if (!context.ok) return context;

  const parsed = CreateObligationTypeSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      AppError.validationFailed({
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      }),
    );
  }

  const coherent = checkRuleCoherence(parsed.data);
  if (!coherent.ok) return coherent;

  const inserted = await insertObligationType(toWritePayload(parsed.data), context.value.userId);
  if (!inserted.ok) return inserted;

  const documents = await replaceRequiredDocuments(
    toObligationTypeId(inserted.value.id),
    parsed.data.required_documents,
  );
  if (!documents.ok) return documents;

  return ok({ id: inserted.value.id });
}

export async function updateObligationType(
  input: unknown,
): Promise<Result<{ readonly id: string }>> {
  const context = await requirePermission("referential.manage");
  if (!context.ok) return context;

  const parsed = UpdateObligationTypeSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      AppError.validationFailed({
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      }),
    );
  }

  const coherent = checkRuleCoherence(parsed.data);
  if (!coherent.ok) return coherent;

  const id = toObligationTypeId(parsed.data.id);

  const current = await getObligationType(id);
  if (!current.ok) return current;

  // Une obligation ne peut pas dépendre d'elle-même, ni directement ni en cycle.
  const cycle = await detectDependencyCycle(id, parsed.data.depends_on_obligation_type_id);
  if (!cycle.ok) return cycle;

  const updated = await updateObligationTypeRow(
    id,
    toWritePayload(parsed.data),
    context.value.userId,
  );
  if (!updated.ok) return updated;

  const documents = await replaceRequiredDocuments(id, parsed.data.required_documents);
  if (!documents.ok) return documents;

  return ok({ id: updated.value.id });
}

/**
 * Cycle de dépendance.
 *
 * La base interdit `depends_on = id` par contrainte CHECK, mais pas A→B→A. Un
 * cycle bloquerait le moteur de génération dans une récursion sans fin ; on le
 * refuse à la saisie.
 */
async function detectDependencyCycle(
  id: ObligationTypeId,
  dependsOn: string | null,
): Promise<Result<null>> {
  if (dependsOn === null) return ok(null);
  if (dependsOn === id) {
    return err(AppError.validationFailed({ field: "depends_on", reason: "SELF_DEPENDENCY" }));
  }

  const seen = new Set<string>([id]);
  let cursor: string | null = dependsOn;

  // Borne : le graphe est fini, mais une donnée déjà corrompue ne doit pas
  // transformer une validation en boucle infinie.
  for (let depth = 0; depth < 32 && cursor !== null; depth += 1) {
    if (seen.has(cursor)) {
      return err(AppError.validationFailed({ field: "depends_on", reason: "DEPENDENCY_CYCLE" }));
    }
    seen.add(cursor);

    const parent: Result<ObligationDetailRow> = await getObligationType(toObligationTypeId(cursor));
    if (!parent.ok) return ok(null); // Parent illisible : la RLS tranchera.
    cursor = parent.value.obligationType.depends_on_obligation_type_id;
  }

  return ok(null);
}

/**
 * Désactivation : arrête les générations FUTURES, ne touche à aucun dossier
 * existant. Refusée si une obligation active dépend de celle-ci — la barrière
 * est doublée par le trigger `prevent_obligation_deactivation`.
 */
export async function deactivateObligationType(
  id: string,
): Promise<Result<{ readonly id: string }>> {
  const context = await requirePermission("referential.manage");
  if (!context.ok) return context;

  const typedId = toObligationTypeId(id);

  const dependents = await countActiveDependents(typedId);
  if (!dependents.ok) return dependents;
  if (dependents.value > 0) {
    return err(
      AppError.conflict({
        details: { reason: "HAS_ACTIVE_DEPENDENTS", count: dependents.value },
      }),
    );
  }

  const updated = await setObligationActive(typedId, false, context.value.userId);
  if (!updated.ok) return updated;
  return ok({ id: updated.value.id });
}

export async function reactivateObligationType(
  id: string,
): Promise<Result<{ readonly id: string }>> {
  const context = await requirePermission("referential.manage");
  if (!context.ok) return context;

  const updated = await setObligationActive(toObligationTypeId(id), true, context.value.userId);
  if (!updated.ok) return updated;
  return ok({ id: updated.value.id });
}

/** Suppression LOGIQUE. Le trigger refuse s'il reste des dossiers non archivés. */
export async function deleteObligationType(id: string): Promise<Result<{ readonly id: string }>> {
  const context = await requirePermission("referential.manage");
  if (!context.ok) return context;

  const deleted = await softDeleteObligationType(toObligationTypeId(id), context.value.userId);
  if (!deleted.ok) return deleted;
  return ok({ id: deleted.value.id });
}

/**
 * Duplication : copie tout sauf l'identité et le cycle de vie.
 *
 * La copie naît INACTIVE. Une obligation dupliquée est un brouillon — la rendre
 * active d'emblée déclencherait la génération d'occurrences sur une règle que
 * personne n'a encore relue.
 */
export async function duplicateObligationType(input: {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}): Promise<Result<{ readonly id: string }>> {
  const context = await requirePermission("referential.manage");
  if (!context.ok) return context;

  const source = await getObligationType(toObligationTypeId(input.id));
  if (!source.ok) return source;

  const row = source.value.obligationType;
  const payload: ObligationWritePayload = {
    code: input.code,
    name: input.name,
    domain_id: row.domain_id,
    authority_id: row.authority_id,
    periodicity: row.periodicity,
    // La règle est recopiée telle quelle : c'est déjà du `Json` validé par la
    // contrainte `is_valid_due_rule` au moment où la source a été écrite.
    due_rule: row.due_rule,
    internal_lead_days: row.internal_lead_days,
    procedure_md: row.procedure_md,
    legal_basis: row.legal_basis,
    portal_url: row.portal_url,
    default_owner_id: row.default_owner_id,
    default_validator_id: row.default_validator_id,
    criticality: row.criticality,
    requires_validation: row.requires_validation,
    validation_levels: row.validation_levels,
    requires_proof: row.requires_proof,
    allow_self_validation: row.allow_self_validation,
    // La dépendance n'est PAS copiée : deux obligations dépendant du même parent
    // est rarement voulu, et se rétablit d'un clic si c'est le cas.
    depends_on_obligation_type_id: null,
    generation_horizon_months: row.generation_horizon_months,
    retention_years: row.retention_years,
    effective_from: row.effective_from,
    effective_to: row.effective_to,
  };

  const inserted = await insertObligationType(payload, context.value.userId);
  if (!inserted.ok) return inserted;

  const newId = toObligationTypeId(inserted.value.id);

  const deactivated = await setObligationActive(newId, false, context.value.userId);
  if (!deactivated.ok) return deactivated;

  const documents = await replaceRequiredDocuments(
    newId,
    source.value.requiredDocuments.map((document) => ({
      label: document.label,
      description: document.description,
      is_mandatory: document.is_mandatory,
      document_kind: document.document_kind,
      max_size_mb: document.max_size_mb,
    })),
  );
  if (!documents.ok) return documents;

  return ok({ id: inserted.value.id });
}

// ─── Recalcul après modification d'une règle ─────────────────────────────────

export interface RecalculationLine {
  readonly occurrenceId: string;
  readonly periodKey: string;
  readonly currentLegalDueDate: string;
  readonly nextLegalDueDate: string;
  readonly currentInternalDueDate: string;
  readonly nextInternalDueDate: string;
  readonly changed: boolean;
}

export interface RecalculationImpact {
  /** Occurrences TODO recalculables et VISIBLES par l'appelant. */
  readonly lines: readonly RecalculationLine[];
  readonly changedCount: number;
  /**
   * Occurrences existantes qui ne seront PAS touchées, par statut. Affiché tel
   * quel : l'utilisateur doit voir ce qui reste en place, pas seulement ce qui
   * bouge.
   */
  readonly protectedByStatus: Readonly<Record<string, number>>;
  /**
   * Vrai quand l'appelant détient `referential.manage` sans pouvoir lire les
   * occurrences du domaine. On le DIT, au lieu d'annoncer « 0 concernée » — ce
   * qui serait exact de son point de vue et trompeur en pratique.
   */
  readonly blindToOccurrences: boolean;
}

const CLOSED_STATUSES = ["VALIDATED", "SUBMITTED", "ARCHIVED", "NOT_APPLICABLE"] as const;

/**
 * Impact d'un changement de règle, AVANT toute écriture.
 *
 * ⚠️ Seules les occurrences TODO sont recalculées. IN_PROGRESS,
 * PENDING_VALIDATION, VALIDATED, SUBMITTED, ARCHIVED et NOT_APPLICABLE ne sont
 * JAMAIS touchées : on ne déplace pas le sol sous les pieds de quelqu'un qui a
 * commencé à travailler. Décision arrêtée, doublée en base par les bornes de
 * `recalculate_todo_due_dates()`.
 */
export async function previewRuleChange(
  id: string,
  candidateRule: unknown,
  candidatePeriodicity?: string,
): Promise<Result<RecalculationImpact>> {
  const context = await requirePermission("referential.manage");
  if (!context.ok) return context;

  const detail = await getObligationType(toObligationTypeId(id));
  if (!detail.ok) return detail;

  const row = detail.value.obligationType;
  const periodicity = (candidatePeriodicity ?? row.periodicity) as Periodicity;

  const rule = validateDueRule({ rule: candidateRule, periodicity });
  if (!rule.ok) return rule;

  const canSeeOccurrences =
    context.value.permissions.has("occurrence.read") &&
    (context.value.domains === null ||
      row.domain_id === null ||
      context.value.domains.has(row.domain_id as never));

  const [existing, recalculable] = await Promise.all([
    listOccurrencesOfObligation(toObligationTypeId(id)),
    listRecalculableOccurrences(toObligationTypeId(id)),
  ]);
  if (!existing.ok) return existing;
  if (!recalculable.ok) return recalculable;

  const protectedByStatus: Record<string, number> = {};
  for (const occurrence of existing.value) {
    if (occurrence.status === "TODO") continue;
    protectedByStatus[occurrence.status] = (protectedByStatus[occurrence.status] ?? 0) + 1;
  }

  const holidays = await holidayDates();
  if (!holidays.ok) return holidays;

  const lines: RecalculationLine[] = [];
  for (const occurrence of recalculable.value) {
    const computed = computeDueDate({
      rule: rule.value,
      period: {
        key: occurrence.period_key,
        periodicity,
        start: new Date(`${occurrence.period_start}T12:00:00.000Z`),
        end: new Date(`${occurrence.period_end}T12:00:00.000Z`),
      },
      anchorDate: anchorDateOf(occurrence),
      holidays: holidays.value,
      internalLeadDays: row.internal_lead_days,
    });
    if (!computed.ok) return computed;

    const nextLegal = isoDate(computed.value.legalDueDate);
    const nextInternal = isoDate(computed.value.internalDueDate);

    lines.push({
      occurrenceId: occurrence.id,
      periodKey: occurrence.period_key,
      currentLegalDueDate: occurrence.legal_due_date,
      nextLegalDueDate: nextLegal,
      currentInternalDueDate: occurrence.internal_due_date,
      nextInternalDueDate: nextInternal,
      changed:
        nextLegal !== occurrence.legal_due_date || nextInternal !== occurrence.internal_due_date,
    });
  }

  return ok({
    lines,
    changedCount: lines.filter((line) => line.changed).length,
    protectedByStatus,
    blindToOccurrences: !canSeeOccurrences,
  });
}

/** Applique le recalcul. Recalcule l'impact plutôt que de croire le client. */
export async function applyRuleChange(
  id: string,
  candidateRule: unknown,
  candidatePeriodicity?: string,
): Promise<Result<{ readonly updated: number }>> {
  const context = await requirePermission("referential.manage");
  if (!context.ok) return context;

  const impact = await previewRuleChange(id, candidateRule, candidatePeriodicity);
  if (!impact.ok) return impact;

  if (impact.value.blindToOccurrences) {
    return err(
      AppError.forbidden({ details: { reason: "RECALCULATION_REQUIRES_OCCURRENCE_READ" } }),
    );
  }

  const updates: DueDateUpdate[] = impact.value.lines
    .filter((line) => line.changed)
    .map((line) => ({
      occurrence_id: line.occurrenceId,
      legal_due_date: line.nextLegalDueDate,
      internal_due_date: line.nextInternalDueDate,
    }));

  const applied = await applyDueDateRecalculation(toObligationTypeId(id), updates);
  if (!applied.ok) return applied;

  return ok({ updated: applied.value });
}

function anchorDateOf(occurrence: OccurrenceRow): Date | undefined {
  const raw = occurrence.expiry_date ?? occurrence.event_date;
  return raw === null ? undefined : new Date(`${raw}T12:00:00.000Z`);
}

function isoDate(instant: Date): string {
  // `formatISO` en date seule : la colonne est un `date`, pas un `timestamptz`.
  return formatISO(instant, { representation: "date" });
}

async function holidayDates(): Promise<Result<readonly Date[]>> {
  const options = await getObligationFormOptions();
  if (!options.ok) return options;
  return ok(options.value.holidays.map((day) => new Date(`${day}T12:00:00.000Z`)));
}

/** Statuts que le recalcul ne touche jamais. Exposé pour l'affichage. */
export const RECALCULATION_PROTECTED_STATUSES = [
  "IN_PROGRESS",
  "PENDING_VALIDATION",
  "REJECTED",
  ...CLOSED_STATUSES,
] as const;

export async function currentUserCanManageReferential(): Promise<boolean> {
  const context = await requireAuthContext();
  return context.ok && context.value.permissions.has("referential.manage");
}
