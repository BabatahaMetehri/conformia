import "server-only";

/**
 * Recherche globale — regroupement par catégorie.
 *
 * Le service ne rejoue aucun filtre d'autorisation : il n'en a pas le moyen, et
 * n'en a pas besoin. La fonction SQL s'exécute sous la RLS de l'appelant ; ce
 * qui arrive ici est déjà, par construction, ce que l'utilisateur a le droit de
 * voir. Ajouter un second filtre applicatif donnerait l'illusion d'une sécurité
 * qui est en réalité entièrement portée par la base.
 */

import { searchEverything, SEARCH_KINDS, type SearchKind } from "@/data/queries/search";

/**
 * Réexporté pour que la couche UI dispose du type sans traverser la frontière
 * de couche : `src/features/**` n'a pas le droit d'importer `src/data/**`.
 */
export type { SearchKind } from "@/data/queries/search";

import { ok, type Result } from "@/lib/result";
import { requireAuthContext } from "@/services/auth/context";

/** Deux caractères : en deçà, tout ressemble à tout. */
export const SEARCH_MIN_LENGTH = 2;

/** Par catégorie, pas au total : la palette montre les trois familles côte à côte. */
export const SEARCH_LIMIT_PER_KIND = 5;

export interface SearchHit {
  readonly kind: SearchKind;
  readonly id: string;
  readonly title: string;
  readonly subtitle: string | null;
}

export interface SearchGroup {
  readonly kind: SearchKind;
  readonly hits: readonly SearchHit[];
}

export interface SearchOutcome {
  /** Requête effectivement exécutée, après normalisation. */
  readonly query: string;
  readonly groups: readonly SearchGroup[];
  readonly total: number;
}

const EMPTY_OUTCOME = (query: string): SearchOutcome => ({ query, groups: [], total: 0 });

/**
 * Recherche dans le référentiel, les occurrences et les pièces.
 *
 * Une saisie trop courte n'est pas une erreur : elle rend un résultat vide. La
 * palette interroge à chaque frappe, elle ne doit pas afficher un message
 * d'erreur au premier caractère.
 */
export async function searchGlobally(rawQuery: string): Promise<Result<SearchOutcome>> {
  const context = await requireAuthContext();
  if (!context.ok) return context;

  const query = rawQuery.trim();
  if (query.length < SEARCH_MIN_LENGTH) return ok(EMPTY_OUTCOME(query));

  const hits = await searchEverything(query, SEARCH_LIMIT_PER_KIND);
  if (!hits.ok) return hits;

  // Ordre des catégories imposé par SEARCH_KINDS, pas par le classement : la
  // place d'un groupe dans la palette ne doit pas bouger d'une frappe à l'autre,
  // sans quoi la cible se dérobe sous le curseur.
  const groups = SEARCH_KINDS.map<SearchGroup>((kind) => ({
    kind,
    hits: hits.value
      .filter((hit) => hit.kind === kind)
      .map(({ id, title, subtitle }) => ({ kind, id, title, subtitle })),
  })).filter((group) => group.hits.length > 0);

  return ok({ query, groups, total: hits.value.length });
}
