import "server-only";

/**
 * Lectures et écritures du moteur de génération.
 *
 * ⚠️ Le moteur tourne HORS SESSION UTILISATEUR : il est appelé par une tâche
 * planifiée. Il emprunte donc le client de service, seul capable de générer des
 * occurrences pour tous les domaines — un générateur soumis à la RLS ne créerait
 * que les dossiers de l'utilisateur qui l'a déclenché, c'est-à-dire personne.
 *
 * Ce module est le SEUL de la couche data à prendre son client en paramètre :
 * le générateur est aussi joignable par une route de secours, où le client de
 * service ne peut pas être chargé (CLAUDE.md §6).
 */

import { mapPostgrestError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

export type GenerationClient = SupabaseClient<Database>;

export interface GeneratableObligation {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly periodicity: string;
  readonly criticality: string;
  readonly dueRule: unknown;
  readonly internalLeadDays: number;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

const OBLIGATION_COLUMNS =
  "id, code, name, periodicity, criticality, due_rule, internal_lead_days, effective_from, effective_to";

/** Une obligation, par identifiant. */
export async function loadObligation(
  client: GenerationClient,
  obligationTypeId: string,
): Promise<Result<GeneratableObligation | null>> {
  const { data, error } = await client
    .from("obligation_types")
    .select(OBLIGATION_COLUMNS)
    .eq("id", obligationTypeId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data === null ? null : toObligation(data));
}

/**
 * Toutes les obligations ACTIVES susceptibles de produire des occurrences.
 *
 * ⚠️ `ON_EVENT` est exclu ICI, à la source. Ces obligations naissent d'un fait —
 * un licenciement, un sinistre — et non du calendrier : en générer d'office
 * remplirait l'échéancier de dossiers sans objet que personne ne pourrait clore.
 */
export async function listGeneratableObligations(
  client: GenerationClient,
): Promise<Result<readonly GeneratableObligation[]>> {
  const { data, error } = await client
    .from("obligation_types")
    .select(OBLIGATION_COLUMNS)
    .eq("is_active", true)
    .neq("periodicity", "ON_EVENT")
    .is("deleted_at", null)
    .order("code");

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data.map(toObligation));
}

function toObligation(row: {
  id: string;
  code: string;
  name: string;
  periodicity: string;
  criticality: string;
  due_rule: unknown;
  internal_lead_days: number;
  effective_from: string;
  effective_to: string | null;
}): GeneratableObligation {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    periodicity: row.periodicity,
    criticality: row.criticality,
    dueRule: row.due_rule,
    internalLeadDays: row.internal_lead_days,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
  };
}

/** Toutes les dates chômées. Le calcul d'échéance les veut toutes. */
export async function loadHolidayDates(
  client: GenerationClient,
): Promise<Result<readonly string[]>> {
  const { data, error } = await client.from("holidays").select("holiday_date");
  if (error !== null) return err(mapPostgrestError(error));
  return ok(data.map((row) => row.holiday_date));
}

export interface OccurrenceDraft {
  readonly periodKey: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly legalDueDate: string;
  readonly internalDueDate: string;
}

/**
 * Crée une occurrence si sa période n'existe pas déjà.
 *
 * Rend l'identifiant créé, ou `null` si la période existait — ce qui n'est pas
 * une erreur mais le comportement recherché.
 */
export async function createOccurrenceIfAbsent(
  client: GenerationClient,
  obligationTypeId: string,
  draft: OccurrenceDraft,
  status: "TODO" | "ARCHIVED" = "TODO",
): Promise<Result<string | null>> {
  const { data, error } = await client.rpc("create_occurrence_if_absent", {
    p_obligation_type_id: obligationTypeId,
    p_period_key: draft.periodKey,
    p_period_start: draft.periodStart,
    p_period_end: draft.periodEnd,
    p_legal_due_date: draft.legalDueDate,
    p_internal_due_date: draft.internalDueDate,
    p_status: status,
  });

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data);
}

export interface FutureTodoOccurrence {
  readonly id: string;
  readonly periodKey: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly legalDueDate: string;
  readonly internalDueDate: string;
}

/**
 * Occurrences FUTURES encore à faire d'une obligation.
 *
 * ⚠️ `TODO` uniquement, et à partir d'une date donnée : on ne recalcule jamais
 * l'échéance d'un dossier déjà engagé. Déplacer le sol sous les pieds de
 * quelqu'un qui travaille est pire que de laisser une échéance périmée.
 */
export async function listFutureTodoOccurrences(
  client: GenerationClient,
  obligationTypeId: string,
  fromDate: string,
): Promise<Result<readonly FutureTodoOccurrence[]>> {
  const { data, error } = await client
    .from("obligation_occurrences")
    .select("id, period_key, period_start, period_end, legal_due_date, internal_due_date")
    .eq("obligation_type_id", obligationTypeId)
    .eq("status", "TODO")
    .eq("is_locked", false)
    .is("deleted_at", null)
    .gte("period_start", fromDate)
    .order("period_start");

  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      id: row.id,
      periodKey: row.period_key,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      legalDueDate: row.legal_due_date,
      internalDueDate: row.internal_due_date,
    })),
  );
}

export async function updateOccurrenceDueDates(
  client: GenerationClient,
  occurrenceId: string,
  legalDueDate: string,
  internalDueDate: string,
): Promise<Result<null>> {
  const { error } = await client
    .from("obligation_occurrences")
    .update({
      legal_due_date: legalDueDate,
      internal_due_date: internalDueDate,
      updated_at: new Date().toISOString(),
    })
    .eq("id", occurrenceId)
    .eq("status", "TODO")
    .eq("is_locked", false);

  if (error !== null) return err(mapPostgrestError(error));
  return ok(null);
}

// ─── Journal d'exécution et verrou ───────────────────────────────────────────

export async function startJobRun(
  client: GenerationClient,
  jobName: string,
): Promise<Result<number>> {
  const { data, error } = await client.rpc("start_job_run", { p_job_name: jobName });
  if (error !== null) return err(mapPostgrestError(error));
  return ok(data);
}

export async function finishJobRun(
  client: GenerationClient,
  runId: number,
  status: "SUCCEEDED" | "PARTIAL" | "FAILED" | "SKIPPED",
  processed: number,
  errors: number,
  details: Record<string, unknown>,
): Promise<Result<null>> {
  const { error } = await client.rpc("finish_job_run", {
    p_run_id: runId,
    p_status: status,
    p_processed: processed,
    p_errors: errors,
    p_details: details as never,
  });
  if (error !== null) return err(mapPostgrestError(error));
  return ok(null);
}

export async function tryLockJob(
  client: GenerationClient,
  jobName: string,
): Promise<Result<boolean>> {
  const { data, error } = await client.rpc("try_lock_job", { p_job_name: jobName });
  if (error !== null) return err(mapPostgrestError(error));
  return ok(data);
}

export async function unlockJob(
  client: GenerationClient,
  jobName: string,
): Promise<Result<boolean>> {
  const { data, error } = await client.rpc("unlock_job", { p_job_name: jobName });
  if (error !== null) return err(mapPostgrestError(error));
  return ok(data);
}
