import "server-only";

/**
 * Lectures des registres de commerce.
 *
 * ⚠️ TOUT passe par `commercial_register_list`, qui calcule déjà le compte à
 * rebours d'expiration et la volumétrie rattachée. Le calculer côté navigateur
 * donnerait un nombre de jours différent selon le fuseau de qui regarde — et
 * l'échéance d'un registre algérien ne dépend pas du fuseau de son lecteur.
 *
 * La vue est en `security_invoker` : la RLS s'applique à travers elle. Ce module
 * ne filtre donc rien par autorisation, il n'aurait aucun moyen de le faire
 * mieux.
 */

import { mapPostgrestError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * ⚠️ Une seule chaîne littérale, jamais de concaténation : supabase-js dérive le
 * type du résultat de la valeur LITTÉRALE passée à `select()`.
 */
const REGISTER_COLUMNS =
  "id, entity_id, rc_number, register_type, label, activity_label, activity_codes, address, wilaya, commune, issued_at, expires_at, status, notes, created_at, updated_at, days_to_expiry, expires_soon, expired, obligation_count, occurrence_count, overdue_count";

export type RegisterType = "PRINCIPAL" | "SECONDAIRE" | "ANNEXE";
export type RegisterStatus = "ACTIF" | "SUSPENDU" | "RADIE";

export interface RegisterRow {
  readonly id: string;
  readonly rcNumber: string;
  readonly registerType: RegisterType;
  readonly label: string;
  readonly activityLabel: string | null;
  readonly activityCodes: readonly string[];
  readonly address: string | null;
  readonly wilaya: string | null;
  readonly commune: string | null;
  readonly issuedAt: string | null;
  readonly expiresAt: string | null;
  readonly status: RegisterStatus;
  readonly notes: string | null;
  /** Jours restants avant expiration ; `null` si le registre n'expire pas. */
  readonly daysToExpiry: number | null;
  readonly expiresSoon: boolean;
  readonly expired: boolean;
  readonly obligationCount: number;
  readonly occurrenceCount: number;
  readonly overdueCount: number;
}

export interface RegisterFilters {
  readonly search?: string;
  readonly registerType?: string;
  readonly status?: string;
  readonly wilaya?: string;
}

interface RawRegister {
  id: string | null;
  rc_number: string | null;
  register_type: string | null;
  label: string | null;
  activity_label: string | null;
  activity_codes: string[] | null;
  address: string | null;
  wilaya: string | null;
  commune: string | null;
  issued_at: string | null;
  expires_at: string | null;
  status: string | null;
  notes: string | null;
  days_to_expiry: number | null;
  expires_soon: boolean | null;
  expired: boolean | null;
  obligation_count: number | null;
  occurrence_count: number | null;
  overdue_count: number | null;
}

function toRow(raw: RawRegister): RegisterRow {
  return {
    id: raw.id ?? "",
    rcNumber: raw.rc_number ?? "",
    registerType: (raw.register_type ?? "SECONDAIRE") as RegisterType,
    label: raw.label ?? "",
    activityLabel: raw.activity_label,
    activityCodes: raw.activity_codes ?? [],
    address: raw.address,
    wilaya: raw.wilaya,
    commune: raw.commune,
    issuedAt: raw.issued_at,
    expiresAt: raw.expires_at,
    status: (raw.status ?? "ACTIF") as RegisterStatus,
    notes: raw.notes,
    daysToExpiry: raw.days_to_expiry,
    expiresSoon: raw.expires_soon ?? false,
    expired: raw.expired ?? false,
    obligationCount: raw.obligation_count ?? 0,
    occurrenceCount: raw.occurrence_count ?? 0,
    overdueCount: raw.overdue_count ?? 0,
  };
}

export async function listRegisters(
  filters: RegisterFilters = {},
): Promise<Result<readonly RegisterRow[]>> {
  const supabase = await createSupabaseServerClient();
  let query = supabase.from("commercial_register_list").select(REGISTER_COLUMNS);

  if (filters.registerType !== undefined && filters.registerType !== "") {
    query = query.eq("register_type", filters.registerType);
  }
  if (filters.status !== undefined && filters.status !== "") {
    query = query.eq("status", filters.status);
  }
  if (filters.wilaya !== undefined && filters.wilaya !== "") {
    query = query.eq("wilaya", filters.wilaya);
  }
  if (filters.search !== undefined && filters.search.trim() !== "") {
    const term = `%${filters.search.trim()}%`;
    query = query.or(`rc_number.ilike.${term},label.ilike.${term},activity_label.ilike.${term}`);
  }

  /*
   * ⚠️ Le PRINCIPAL en tête, puis par numéro. Trier par date de création
   * placerait le siège au milieu des établissements dès qu'on en ajoute un :
   * l'ordre d'une liste doit refléter la structure, pas l'historique de saisie.
   */
  const { data, error } = await query
    .order("register_type", { ascending: true })
    .order("rc_number", { ascending: true });

  if (error !== null) return err(mapPostgrestError(error));
  return ok((data as RawRegister[]).map(toRow));
}

export async function getRegister(id: string): Promise<Result<RegisterRow | null>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("commercial_register_list")
    .select(REGISTER_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data === null ? null : toRow(data as RawRegister));
}

/** Wilayas réellement portées par au moins un registre — pour un filtre honnête. */
export async function listRegisterWilayas(): Promise<Result<readonly string[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("commercial_register_list")
    .select("wilaya")
    .not("wilaya", "is", null)
    .order("wilaya", { ascending: true });

  if (error !== null) return err(mapPostgrestError(error));

  const seen = new Set<string>();
  for (const row of data as { wilaya: string | null }[]) {
    if (row.wilaya !== null && row.wilaya !== "") seen.add(row.wilaya);
  }
  return ok([...seen]);
}

// ─── Chronologie du registre lui-même ────────────────────────────────────────

export interface RegisterTimelineEntry {
  readonly occurredAt: string;
  readonly action: string;
  readonly actorName: string | null;
  readonly changedFields: readonly string[];
}

export async function getRegisterTimeline(
  id: string,
): Promise<Result<readonly RegisterTimelineEntry[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("register_timeline", { p_register_id: id });

  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    (
      data as {
        occurred_at: string;
        action: string;
        actor_name: string | null;
        changed_fields: string[] | null;
      }[]
    ).map((row) => ({
      occurredAt: row.occurred_at,
      action: row.action,
      actorName: row.actor_name,
      changedFields: row.changed_fields ?? [],
    })),
  );
}

// ─── Situation par registre ──────────────────────────────────────────────────

export interface RegisterCompliance {
  readonly registerId: string;
  readonly rcNumber: string;
  readonly label: string;
  readonly wilaya: string | null;
  readonly status: RegisterStatus;
  readonly total: number;
  readonly submitted: number;
  readonly overdue: number;
  /** `null` quand le registre n'a aucun dossier — pas « 0 % ». */
  readonly complianceRate: number | null;
}

export async function getRegisterCompliance(): Promise<Result<readonly RegisterCompliance[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("register_compliance");

  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    (
      data as {
        register_id: string;
        rc_number: string;
        label: string;
        wilaya: string | null;
        status: string;
        total: number;
        submitted: number;
        overdue: number;
        compliance_rate: number | null;
      }[]
    ).map((row) => ({
      registerId: row.register_id,
      rcNumber: row.rc_number,
      label: row.label,
      wilaya: row.wilaya,
      status: row.status as RegisterStatus,
      total: row.total,
      submitted: row.submitted,
      overdue: row.overdue,
      complianceRate: row.compliance_rate,
    })),
  );
}

// ─── Obligations et pièces rattachées ────────────────────────────────────────

export interface RegisterObligationRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly periodicity: string;
  readonly isActive: boolean;
}

/**
 * Obligations de portée « par registre ».
 *
 * ⚠️ Elles ne sont pas rattachées à UN registre : une obligation PER_REGISTER
 * vaut pour TOUS les établissements actifs de l'entité, et c'est le générateur
 * qui produit un dossier par registre. Les lister « du registre » serait donc
 * inexact ; on liste celles qui le CONCERNENT.
 */
export async function listRegisterObligations(): Promise<Result<readonly RegisterObligationRow[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("obligation_types")
    .select("id, code, name, periodicity, is_active")
    .eq("scope", "PER_REGISTER")
    .is("deleted_at", null)
    .order("code", { ascending: true });

  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      periodicity: row.periodicity,
      isActive: row.is_active,
    })),
  );
}

export interface RegisterDocumentRow {
  readonly id: string;
  readonly filename: string;
  readonly occurrenceId: string;
  readonly obligationName: string;
  readonly periodKey: string;
  readonly uploadedAt: string;
  readonly uploaderName: string | null;
}

/** Pièces déposées sur les dossiers d'un registre, la plus récente d'abord. */
export async function listRegisterDocuments(
  registerId: string,
): Promise<Result<readonly RegisterDocumentRow[]>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("documents")
    .select(
      "id, occurrence_id, original_filename, uploaded_at, uploader:profiles!documents_uploaded_by_fkey(full_name), occurrence:obligation_occurrences!inner(period_key, commercial_register_id, obligation_types!inner(name))",
    )
    .eq("occurrence.commercial_register_id", registerId)
    .is("deleted_at", null)
    .order("uploaded_at", { ascending: false })
    .limit(300);

  if (error !== null) return err(mapPostgrestError(error));

  type Joined = {
    id: string;
    occurrence_id: string;
    original_filename: string;
    uploaded_at: string;
    uploader: { full_name: string | null } | null;
    occurrence: { period_key: string; obligation_types: { name: string } } | null;
  };

  return ok(
    (data as unknown as Joined[]).map((row) => ({
      id: row.id,
      filename: row.original_filename,
      occurrenceId: row.occurrence_id,
      obligationName: row.occurrence?.obligation_types.name ?? "",
      periodKey: row.occurrence?.period_key ?? "",
      uploadedAt: row.uploaded_at,
      uploaderName: row.uploader?.full_name ?? null,
    })),
  );
}
