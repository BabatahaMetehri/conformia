/**
 * Filtres de l'échéancier — schéma UNIQUE, partagé client et serveur.
 *
 * ⚠️ PAS de `server-only` : le même schéma analyse les paramètres d'URL côté
 * navigateur et côté serveur. Deux analyseurs se répondant l'un l'autre
 * divergeraient au premier filtre ajouté.
 *
 * Les filtres vivent dans l'URL. Elle est la source de vérité d'une vue
 * partagée ; la mémorisation par utilisateur ne sert qu'au retour sur un écran
 * sans paramètres.
 */

import { z } from "zod";

import { Criticality, OCCURRENCE_STATUSES, OccurrenceStatus } from "@/config/constants";

/** 50 lignes par page. Au-delà, le rendu du tableau devient perceptible. */
export const OCCURRENCE_PAGE_SIZE = 50;

/**
 * Colonnes de tri autorisées. Liste BLANCHE : le nom de colonne finit dans un
 * `order by`, et accepter une chaîne libre y ouvrirait une injection.
 */
export const OCCURRENCE_SORT_COLUMNS = [
  "internal_due_date",
  "legal_due_date",
  "period_key",
  "status",
  "obligation_code",
  "criticality",
] as const;

export type OccurrenceSortColumn = (typeof OCCURRENCE_SORT_COLUMNS)[number];

const csv = <T extends string>(values: readonly T[]) =>
  z
    .string()
    .transform((raw) => raw.split(",").filter((part) => part.length > 0))
    .pipe(z.array(z.enum(values as [T, ...T[]])))
    .optional();

export const OccurrenceFiltersSchema = z.object({
  /** Clé de période exacte (`2026-01`) ou préfixe d'année (`2026`). */
  period: z.string().trim().max(20).optional(),
  /** Multiple : la file de travail se regarde rarement statut par statut. */
  status: csv(OCCURRENCE_STATUSES as readonly OccurrenceStatus[]),
  domain: z.uuid().optional(),
  authority: z.uuid().optional(),
  owner: z.uuid().optional(),
  criticality: z.enum(Criticality).optional(),
  /** Retard LÉGAL. L'alerte précoce a son propre filtre. */
  overdue: z.coerce.boolean().optional(),
  internallyLate: z.coerce.boolean().optional(),
  rectifications: z.coerce.boolean().optional(),
  /** Restreint aux dossiers dont l'appelant est responsable. */
  mine: z.coerce.boolean().optional(),
  sort: z.enum(OCCURRENCE_SORT_COLUMNS).default("internal_due_date"),
  direction: z.enum(["asc", "desc"]).default("asc"),
  cursor: z.string().max(200).optional(),
});

export type OccurrenceFilters = z.infer<typeof OccurrenceFiltersSchema>;
export type OccurrenceFiltersInput = z.input<typeof OccurrenceFiltersSchema>;

/**
 * Filtres normalisés depuis des paramètres d'URL bruts.
 *
 * Ne lève jamais : une URL bricolée à la main doit rendre la liste par défaut,
 * pas un écran d'erreur. Un filtre incompréhensible est ignoré, les autres
 * s'appliquent.
 */
export function parseOccurrenceFilters(
  params: Record<string, string | string[] | undefined>,
): OccurrenceFilters {
  const single = (key: string): string | undefined => {
    const value = params[key];
    const raw = Array.isArray(value) ? value[0] : value;
    return raw === undefined || raw.length === 0 ? undefined : raw;
  };

  const candidate = {
    period: single("period"),
    status: single("status"),
    domain: single("domain"),
    authority: single("authority"),
    owner: single("owner"),
    criticality: single("criticality"),
    overdue: single("overdue"),
    internallyLate: single("internallyLate"),
    rectifications: single("rectifications"),
    mine: single("mine"),
    sort: single("sort"),
    direction: single("direction"),
    cursor: single("cursor"),
  };

  const parsed = OccurrenceFiltersSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;

  // Analyse champ par champ : un paramètre douteux ne doit pas emporter les autres.
  const salvaged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (value === undefined) continue;
    const attempt = OccurrenceFiltersSchema.safeParse({ [key]: value });
    if (attempt.success) salvaged[key] = value;
  }
  return OccurrenceFiltersSchema.parse(salvaged);
}

/** Sérialise des filtres en paramètres d'URL — l'inverse exact de l'analyse. */
export function toSearchParams(filters: Partial<OccurrenceFiltersInput>): URLSearchParams {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === false || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(","));
      continue;
    }
    // Les valeurs de filtre sont des primitives : tout le reste serait une
    // erreur de programmation, et se stringifierait en « [object Object] ».
    if (typeof value === "string") params.set(key, value);
    else if (typeof value === "number" || typeof value === "boolean") {
      params.set(key, String(value));
    }
  }
  return params;
}

/** Vrai si un filtre autre que le tri et le curseur est actif. */
export function hasActiveFilters(filters: OccurrenceFilters): boolean {
  return (
    filters.period !== undefined ||
    (filters.status !== undefined && filters.status.length > 0) ||
    filters.domain !== undefined ||
    filters.authority !== undefined ||
    filters.owner !== undefined ||
    filters.criticality !== undefined ||
    filters.overdue === true ||
    filters.internallyLate === true ||
    filters.rectifications === true ||
    filters.mine === true
  );
}

/** Filtres à mémoriser : ni le curseur (volatil), ni rien qui pointe une page. */
export function persistableFilters(filters: OccurrenceFilters): Record<string, unknown> {
  const persisted: Record<string, unknown> = { ...filters };
  // Le curseur pointe une position dans un jeu de résultats qui n existera plus
  // au prochain retour sur l écran.
  delete persisted["cursor"];
  return persisted;
}
