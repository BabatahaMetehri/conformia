import "server-only";

/**
 * Écritures sur les registres de commerce.
 *
 * Toutes déclenchent `audit_trigger()` : acteur, avant, après et champs modifiés
 * sont journalisés par la BASE, pas par la discipline de l'appelant
 * (cf. CLAUDE.md §3.6). C'est ce journal que la chronologie du registre relit.
 *
 * ⚠️ AUCUNE SUPPRESSION PHYSIQUE. Un registre se RADIE — statut `RADIE` — ou se
 * supprime logiquement. L'effacer emporterait le rattachement des dossiers qu'il
 * a produits : des déclarations déposées se retrouveraient orphelines, et
 * l'entreprise perdrait la preuve de l'établissement pour lequel elle les a
 * faites.
 */

import { AppError, mapPostgrestError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface RegisterWritePayload {
  readonly rc_number: string;
  readonly register_type: string;
  readonly label: string;
  readonly activity_label: string | null;
  readonly activity_codes: readonly string[];
  readonly address: string | null;
  readonly wilaya: string | null;
  readonly commune: string | null;
  readonly issued_at: string | null;
  readonly expires_at: string | null;
  readonly status: string;
  readonly notes: string | null;
}

const RETURNING =
  "id, entity_id, rc_number, register_type, label, activity_label, activity_codes, address, wilaya, commune, issued_at, expires_at, status, notes, created_by, created_at, updated_by, updated_at, deleted_at";

export async function insertRegister(
  payload: RegisterWritePayload,
  actorId: string,
): Promise<Result<{ readonly id: string }>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("commercial_registers")
    .insert({
      ...payload,
      activity_codes: [...payload.activity_codes],
      created_by: actorId,
      updated_by: actorId,
    })
    .select(RETURNING)
    .single();

  if (error !== null) return err(mapPostgrestError(error));
  return ok({ id: data.id });
}

export async function updateRegisterRow(
  id: string,
  payload: RegisterWritePayload,
  actorId: string,
): Promise<Result<{ readonly id: string }>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("commercial_registers")
    .update({
      ...payload,
      activity_codes: [...payload.activity_codes],
      updated_by: actorId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(RETURNING)
    .maybeSingle();

  if (error !== null) return err(mapPostgrestError(error));
  if (data === null) {
    /*
     * ⚠️ Zéro ligne rendue N'EST PAS une erreur technique : c'est la politique
     * UPDATE qui n'a laissé passer aucune ligne. On le dit comme un refus, et
     * non comme une absence — un « introuvable » enverrait chercher un
     * identifiant erroné là où il s'agit d'un droit manquant.
     */
    return err(AppError.forbidden({ details: { registerId: id } }));
  }
  return ok({ id: data.id });
}
