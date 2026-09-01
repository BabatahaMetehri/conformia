import "server-only";

/**
 * Lectures du circuit de validation.
 *
 * ⚠️ Aucune règle de transition n'est écrite ici. Le verdict vient d'une seule
 * fonction, `evaluate_transition`, qui est aussi celle que consulte
 * `apply_occurrence_transition` avant d'écrire. Ce module transporte une
 * question et rapporte une réponse.
 */

import { mapPostgrestError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Criticality, OccurrenceStatus } from "@/config/constants";

/** Vocabulaire complet des verdicts rendus par `evaluate_transition`. */
export type TransitionVerdictCode =
  | "ALLOWED"
  | "NO_CHANGE"
  | "NOT_FOUND"
  | "INVALID_TRANSITION"
  | "LOCKED"
  | "FORBIDDEN"
  | "REASON_REQUIRED"
  | "INCOMPLETE"
  | "SELF_VALIDATION_BLOCKED"
  | "SECOND_LEVEL_REQUIRES_DIRECTION"
  | "REFERENCE_REQUIRED"
  | "PROOF_REQUIRED"
  | "LATE_REASON_REQUIRED";

export interface TransitionVerdict {
  readonly outcome: TransitionVerdictCode;
  /** `PARTIAL_VALIDATION` quand l'appel comptera comme premier des deux niveaux. */
  readonly effect: "FULL" | "PARTIAL_VALIDATION" | null;
  readonly missing: readonly string[];
  readonly obtained: number | null;
  readonly required: number | null;
  readonly permission: string | null;
  readonly dueDate: string | null;
  readonly version: number | null;
  readonly label: string | null;
}

function readVerdict(payload: unknown): TransitionVerdict {
  const record = (payload ?? {}) as Record<string, unknown>;
  const text = (key: string): string | null =>
    typeof record[key] === "string" ? record[key] : null;
  const num = (key: string): number | null =>
    typeof record[key] === "number" ? record[key] : null;
  const missing = record["missing"];

  return {
    outcome: (record["outcome"] as TransitionVerdictCode | undefined) ?? "NOT_FOUND",
    effect: (record["effect"] as TransitionVerdict["effect"] | undefined) ?? null,
    missing: Array.isArray(missing) ? missing.map((entry) => String(entry)) : [],
    obtained: num("obtained"),
    required: num("required"),
    permission: text("permission"),
    dueDate: text("dueDate"),
    version: num("version"),
    label: text("label"),
  };
}

export interface EvaluateInput {
  readonly occurrenceId: string;
  readonly toStatus: OccurrenceStatus;
  readonly reason?: string | null | undefined;
  readonly referenceNumber?: string | null | undefined;
  readonly lateReasonCode?: string | null | undefined;
}

export async function evaluateTransition(input: EvaluateInput): Promise<Result<TransitionVerdict>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("evaluate_transition", {
    p_occurrence_id: input.occurrenceId,
    p_to_status: input.toStatus,
    ...(input.reason == null ? {} : { p_reason: input.reason }),
    ...(input.referenceNumber == null ? {} : { p_reference_number: input.referenceNumber }),
    ...(input.lateReasonCode == null
      ? {}
      : { p_late_reason_code: input.lateReasonCode as "OTHER" }),
  });

  if (error !== null) return err(mapPostgrestError(error));
  return ok(readVerdict(data));
}

// ─── Matrice des transitions ─────────────────────────────────────────────────

export interface TransitionRuleRow {
  readonly fromStatus: OccurrenceStatus;
  readonly toStatus: OccurrenceStatus;
  readonly requiredPermission: string;
  readonly requiresReason: boolean;
  readonly locksOccurrence: boolean;
  readonly label: string;
}

/**
 * La matrice, telle qu'elle est EN BASE.
 *
 * ⚠️ Aucune transition n'est déclarée en TypeScript, nulle part. L'interface
 * propose ce que cette table contient ; ajouter une transition est une ligne de
 * référentiel, pas un déploiement (CLAUDE.md §3.5).
 */
export async function listTransitionRules(): Promise<Result<readonly TransitionRuleRow[]>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("status_transition_rules")
    .select("from_status, to_status, required_permission, requires_reason, locks_occurrence, label")
    .order("from_status")
    .order("to_status");

  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      fromStatus: row.from_status,
      toStatus: row.to_status,
      requiredPermission: row.required_permission,
      requiresReason: row.requires_reason,
      locksOccurrence: row.locks_occurrence,
      label: row.label,
    })),
  );
}

// ─── File de validation ──────────────────────────────────────────────────────

const QUEUE_COLUMNS =
  "id, obligation_type_id, period_key, period_start, legal_due_date, internal_due_date, status, version, owner_id, validator_id, submitted_for_validation_at, obligation_code, obligation_name, criticality, validation_levels, domain_code, authority_name, owner_name, validations_obtained, days_to_internal";

export interface ValidationQueueRow {
  readonly id: string;
  readonly periodKey: string;
  readonly legalDueDate: string;
  readonly internalDueDate: string;
  readonly version: number;
  readonly obligationCode: string;
  readonly obligationName: string;
  readonly criticality: Criticality;
  readonly validationLevels: number;
  readonly validationsObtained: number;
  readonly authorityName: string | null;
  readonly ownerName: string | null;
  readonly submittedForValidationAt: string | null;
  readonly daysToInternal: number;
}

export async function listValidationQueue(): Promise<Result<readonly ValidationQueueRow[]>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.from("validation_queue").select(QUEUE_COLUMNS);

  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      id: row.id ?? "",
      periodKey: row.period_key ?? "",
      legalDueDate: row.legal_due_date ?? "",
      internalDueDate: row.internal_due_date ?? "",
      version: row.version ?? 1,
      obligationCode: row.obligation_code ?? "",
      obligationName: row.obligation_name ?? "",
      criticality: row.criticality ?? "LOW",
      validationLevels: row.validation_levels ?? 1,
      validationsObtained: row.validations_obtained ?? 0,
      authorityName: row.authority_name,
      ownerName: row.owner_name,
      submittedForValidationAt: row.submitted_for_validation_at,
      daysToInternal: row.days_to_internal ?? 0,
    })),
  );
}

/** Compteur de navigation. Mêmes conditions que la file, à la ligne près. */
export async function countPendingValidations(): Promise<Result<number>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("pending_validation_count");
  if (error !== null) return err(mapPostgrestError(error));
  return ok(data);
}

// ─── Délégations ─────────────────────────────────────────────────────────────

export interface DelegationRow {
  readonly id: string;
  readonly delegatorId: string;
  readonly delegatorName: string | null;
  readonly delegateId: string;
  readonly delegateName: string | null;
  readonly domainCode: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly reason: string;
  readonly revokedAt: string | null;
  readonly isActive: boolean;
}

export async function listDelegations(): Promise<Result<readonly DelegationRow[]>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("validation_delegations")
    .select(
      "id, delegator_id, delegate_id, domain_id, starts_at, ends_at, reason, revoked_at, created_at, delegator:profiles!validation_delegations_delegator_id_fkey(full_name), delegate:profiles!validation_delegations_delegate_id_fkey(full_name), domains(code)",
    )
    .order("created_at", { ascending: false });

  if (error !== null) return err(mapPostgrestError(error));

  // ⚠️ L'activité se calcule sur des DATES, pas sur `revoked_at` seul : une
  // délégation non révoquée mais expirée ne prête plus rien, et l'écran doit le
  // dire — c'est exactement ce que `effective_principals()` applique en base.
  const today = new Date().toISOString().slice(0, 10);

  return ok(
    data.map((row) => ({
      id: row.id,
      delegatorId: row.delegator_id,
      delegatorName: row.delegator.full_name,
      delegateId: row.delegate_id,
      delegateName: row.delegate.full_name,
      domainCode: row.domains?.code ?? null,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      reason: row.reason,
      revokedAt: row.revoked_at,
      isActive: row.revoked_at === null && row.starts_at <= today && today <= row.ends_at,
    })),
  );
}

// ─── Notifications ───────────────────────────────────────────────────────────

export interface NotificationRow {
  readonly id: number;
  readonly kind: string;
  readonly occurrenceId: string | null;
  readonly reason: string | null;
  readonly createdAt: string;
  readonly readAt: string | null;
}

export async function listNotifications(limit = 50): Promise<Result<readonly NotificationRow[]>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("notifications")
    .select("id, kind, occurrence_id, reason, created_at, read_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      id: row.id,
      kind: row.kind,
      occurrenceId: row.occurrence_id,
      reason: row.reason,
      createdAt: row.created_at,
      readAt: row.read_at,
    })),
  );
}
