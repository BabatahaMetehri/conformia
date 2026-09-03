import "server-only";

/**
 * Recherche globale.
 *
 * La couche data n'interprète rien : elle appelle la fonction et traduit ses
 * lignes. Le découpage par catégorie et l'ordonnancement appartiennent au
 * service ; le cloisonnement, lui, appartient à la base.
 */

import { AppError, mapPostgrestError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Les trois familles d'objets atteignables par la palette. */
export const SEARCH_KINDS = ["OBLIGATION", "OCCURRENCE", "DOCUMENT", "REGISTER"] as const;

export type SearchKind = (typeof SEARCH_KINDS)[number];

export interface SearchHitRow {
  readonly kind: SearchKind;
  readonly id: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly rank: number;
}

function isSearchKind(value: string): value is SearchKind {
  return SEARCH_KINDS.some((kind) => kind === value);
}

/**
 * ⚠️ `global_search()` est SECURITY INVOKER : la RLS s'applique. Un utilisateur
 * ne trouve jamais ce qu'il n'a pas le droit de lire, et une absence de
 * résultat ne distingue pas « inexistant » de « interdit » — c'est exactement la
 * propriété recherchée.
 */
export async function searchEverything(
  query: string,
  limitPerKind: number,
): Promise<Result<readonly SearchHitRow[]>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("global_search", {
    p_query: query,
    p_limit: limitPerKind,
  });

  if (error !== null) return err(mapPostgrestError(error));

  const hits: SearchHitRow[] = [];
  for (const row of data) {
    // `kind` est déclaré `text` par la fonction SQL : le type généré ne peut pas
    // le restreindre. Une valeur inattendue signalerait une divergence entre la
    // migration et ce module — on la refuse plutôt que de la laisser filer.
    if (!isSearchKind(row.kind)) {
      return err(AppError.internal({ details: { reason: "SEARCH_KIND_UNKNOWN", kind: row.kind } }));
    }
    hits.push({
      kind: row.kind,
      id: row.result_id,
      title: row.title,
      subtitle: row.subtitle,
      rank: row.rank,
    });
  }

  return ok(hits);
}
