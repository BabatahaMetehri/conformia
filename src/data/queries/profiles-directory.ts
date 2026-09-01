import "server-only";

/**
 * Annuaire réduit des personnes à qui un dossier peut être confié.
 *
 * Passe par la vue `profiles_directory` : identité d'affichage sans
 * coordonnées, et `security_invoker` — la politique de `public.profiles`
 * s'applique à travers elle, elle n'est pas contournée.
 */

import { mapPostgrestError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface AssignableProfileRow {
  readonly id: string;
  readonly fullName: string;
}

export async function listAssignableProfiles(): Promise<Result<readonly AssignableProfileRow[]>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("is_active", true)
    .order("full_name", { ascending: true })
    .limit(500);

  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data
      .filter((row): row is { id: string; full_name: string } => row.full_name !== null)
      .map((row) => ({ id: row.id, fullName: row.full_name })),
  );
}
