import "server-only";

/**
 * Lectures des absences déclarées.
 *
 * ⚠️ CE QUE CES DONNÉES NE FONT PAS : accorder ou retirer un droit. Une absence
 * est une information d'ORGANISATION. Elle oriente l'acheminement des rappels ;
 * elle ne touche à aucune permission, et le suppléant peut agir en permanence,
 * qu'une absence soit déclarée ou non. `is_absent_on()` n'est appelée par aucune
 * politique RLS, et un test le vérifie structurellement à chaque exécution.
 *
 * La vue `current_absences` est en `security_invoker` : savoir qui est absent
 * n'est pas confidentiel — c'est ce qui permet de comprendre pourquoi un dossier
 * n'avance pas — mais la RLS reste seule juge de qui voit quoi.
 */

import { mapPostgrestError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const ABSENCE_COLUMNS =
  "id, user_id, user_name, starts_at, ends_at, reason, created_at, revoked_at, is_current, days_remaining";

export interface AbsenceRow {
  readonly id: string;
  readonly userId: string;
  readonly userName: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly reason: string;
  readonly createdAt: string;
  readonly revokedAt: string | null;
  readonly isCurrent: boolean;
  readonly daysRemaining: number;
}

interface RawAbsence {
  id: string | null;
  user_id: string | null;
  user_name: string | null;
  starts_at: string | null;
  ends_at: string | null;
  reason: string | null;
  created_at: string | null;
  revoked_at: string | null;
  is_current: boolean | null;
  days_remaining: number | null;
}

function toRow(raw: RawAbsence): AbsenceRow {
  return {
    id: raw.id ?? "",
    userId: raw.user_id ?? "",
    userName: raw.user_name ?? "",
    startsAt: raw.starts_at ?? "",
    endsAt: raw.ends_at ?? "",
    reason: raw.reason ?? "",
    createdAt: raw.created_at ?? "",
    revokedAt: raw.revoked_at,
    isCurrent: raw.is_current ?? false,
    daysRemaining: raw.days_remaining ?? 0,
  };
}

export async function listAbsences(): Promise<Result<readonly AbsenceRow[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("current_absences")
    .select(ABSENCE_COLUMNS)
    /*
     * Les absences EN COURS d'abord, puis les plus récentes. Une liste triée par
     * date de saisie enterrerait l'absence du jour sous des déclarations
     * anciennes — or c'est celle du jour qui explique pourquoi un dossier
     * n'avance pas.
     */
    .order("is_current", { ascending: false })
    .order("starts_at", { ascending: false })
    .limit(200);

  if (error !== null) return err(mapPostgrestError(error));
  return ok((data as RawAbsence[]).map(toRow));
}

/** Absences en cours — l'indicateur du tableau de bord. */
export async function listCurrentAbsences(): Promise<Result<readonly AbsenceRow[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("current_absences")
    .select(ABSENCE_COLUMNS)
    .eq("is_current", true)
    .order("ends_at", { ascending: true })
    .limit(20);

  if (error !== null) return err(mapPostgrestError(error));
  return ok((data as RawAbsence[]).map(toRow));
}

export interface AbsenceWritePayload {
  readonly user_id: string;
  readonly starts_at: string;
  readonly ends_at: string;
  readonly reason: string;
}

export async function insertAbsence(
  payload: AbsenceWritePayload,
  actorId: string,
): Promise<Result<{ readonly id: string }>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("user_absences")
    .insert({ ...payload, created_by: actorId })
    .select("id")
    .single();

  if (error !== null) return err(mapPostgrestError(error));
  return ok({ id: data.id });
}

/**
 * Révocation anticipée.
 *
 * ⚠️ `revoked_at`, PAS un DELETE. Une absence effacée effacerait la raison pour
 * laquelle un dossier a changé de mains, et le journal des rappels renverrait
 * alors à une explication qui n'existe plus.
 */
export async function revokeAbsence(
  id: string,
  actorId: string,
): Promise<Result<{ readonly id: string }>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("user_absences")
    .update({ revoked_at: new Date().toISOString(), revoked_by: actorId })
    .eq("id", id)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();

  if (error !== null) return err(mapPostgrestError(error));
  if (data === null) return ok({ id });
  return ok({ id: data.id });
}
