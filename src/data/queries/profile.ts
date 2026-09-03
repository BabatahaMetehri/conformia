import "server-only";

/**
 * Lectures de la fiche « Mon profil ».
 *
 * ⚠️ Uniquement des LIBELLÉS. Le contexte de session porte déjà les rôles, les
 * domaines et l'état du second facteur, mais sous forme d'identifiants : cette
 * requête ne fait que les rendre lisibles. Aucune décision d'accès ne se prend
 * ici — elles sont toutes déjà prises, en base.
 */

import { mapPostgrestError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface ProfileLabels {
  /** Libellé lisible d'un domaine, par identifiant. */
  readonly domains: ReadonlyMap<string, string>;
  /** Libellé lisible d'un rôle, par code. */
  readonly roles: ReadonlyMap<string, string>;
  readonly departmentName: string | null;
}

export async function loadProfileLabels(
  departmentId: string | null,
): Promise<Result<ProfileLabels>> {
  const supabase = await createSupabaseServerClient();

  const [domains, roles] = await Promise.all([
    supabase.from("domains").select("id, label"),
    supabase.from("roles").select("code, label"),
  ]);

  if (domains.error !== null) return err(mapPostgrestError(domains.error));
  if (roles.error !== null) return err(mapPostgrestError(roles.error));

  let departmentName: string | null = null;
  if (departmentId !== null) {
    const department = await supabase
      .from("departments")
      .select("name")
      .eq("id", departmentId)
      .maybeSingle();

    // Un service illisible n'est pas une erreur d'écran : la RLS peut le
    // masquer sans que la fiche perde son sens. On affiche « non renseigné ».
    if (department.error === null) departmentName = department.data?.name ?? null;
  }

  return ok({
    domains: new Map(domains.data.map((row) => [row.id, row.label])),
    roles: new Map(roles.data.map((row) => [row.code, row.label])),
    departmentName,
  });
}
