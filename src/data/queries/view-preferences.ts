import "server-only";

/**
 * Préférences d'affichage par utilisateur.
 *
 * Confort d'usage : aucune donnée métier, aucune valeur probante. Un échec ici
 * ne doit jamais empêcher un écran de s'afficher — les appelants traitent
 * l'erreur en l'ignorant, ce qui est le comportement voulu.
 */

import { mapPostgrestError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database.types";
import type { ProfileId } from "@/types/domain";

export async function loadViewPreferences(
  userId: ProfileId,
  viewKey: string,
): Promise<Result<Record<string, unknown> | null>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("user_view_preferences")
    .select("filters")
    .eq("user_id", userId)
    .eq("view_key", viewKey)
    .maybeSingle();

  if (error !== null) return err(mapPostgrestError(error));
  if (data === null) return ok(null);

  const filters = data.filters;
  // Le JSONB peut contenir n'importe quoi ; seul un objet a du sens ici, et
  // l'appelant le repasse de toute façon par le schéma Zod des filtres.
  if (typeof filters !== "object" || filters === null || Array.isArray(filters)) {
    return ok(null);
  }
  return ok(filters as Record<string, unknown>);
}

export async function saveViewPreferences(
  userId: ProfileId,
  viewKey: string,
  filters: Record<string, unknown>,
): Promise<Result<null>> {
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.from("user_view_preferences").upsert(
    {
      user_id: userId,
      view_key: viewKey,
      filters: filters as Json,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,view_key" },
  );

  if (error !== null) return err(mapPostgrestError(error));
  return ok(null);
}
