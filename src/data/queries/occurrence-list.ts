import "server-only";

/**
 * Lectures de l'écran de travail.
 *
 * ⚠️ TOUT passe par la vue `occurrence_list`, qui joint déjà l'obligation, le
 * domaine, l'organisme, le responsable, le validateur et les compteurs de
 * pièces. Une seule requête rend une page complète : aucun aller-retour
 * supplémentaire par ligne, jamais.
 *
 * La vue est en `security_invoker` : la RLS s'applique intégralement à travers
 * elle. Ce module ne filtre donc rien par autorisation, il n'aurait aucun moyen
 * de le faire mieux.
 */

import { OCCURRENCE_PAGE_SIZE, type OccurrenceFilters } from "@/services/occurrences/filters";
import { AppError, mapPostgrestError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CursorPage, ProfileId } from "@/types/domain";

/**
 * ⚠️ Une seule chaîne littérale, jamais de concaténation : supabase-js dérive le
 * type du résultat de la valeur LITTÉRALE passée à `select()`. Un `"a" + "b"`
 * produit le type `string` et tout le retour s'effondre en `GenericStringError`.
 */
const LIST_COLUMNS =
  "id, obligation_type_id, obligation_code, obligation_name, obligation_scope, period_key, period_start, period_end, internal_due_date, legal_due_date, status, owner_id, owner_name, deputy_id, deputy_name, validator_id, validator_name, commercial_register_id, register_number, register_label, register_status, documents_provided, documents_required, is_overdue, is_internally_late, days_to_internal, days_to_legal, criticality, periodicity, domain_id, domain_code, domain_label, authority_id, authority_name, rectification_index, rectifies_occurrence_id, reference_number, is_locked";

export interface OccurrenceListRow {
  readonly id: string;
  readonly obligationTypeId: string;
  readonly obligationCode: string;
  readonly obligationName: string;
  readonly periodKey: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly internalDueDate: string;
  readonly legalDueDate: string;
  readonly status: string;
  readonly ownerId: string | null;
  readonly ownerName: string | null;
  readonly deputyId: string | null;
  readonly deputyName: string | null;
  readonly validatorId: string | null;
  readonly validatorName: string | null;
  /** `ENTITY` ou `PER_REGISTER` : ce qui distingue « toute l'entreprise » d'un établissement. */
  readonly obligationScope: string;
  readonly registerId: string | null;
  readonly registerNumber: string | null;
  readonly registerLabel: string | null;
  readonly registerStatus: string | null;
  readonly documentsProvided: number;
  readonly documentsRequired: number;
  readonly isOverdue: boolean;
  readonly isInternallyLate: boolean;
  readonly daysToInternal: number;
  readonly daysToLegal: number;
  readonly criticality: string;
  readonly periodicity: string;
  readonly domainId: string | null;
  readonly domainLabel: string | null;
  readonly authorityName: string | null;
  readonly rectificationIndex: number;
  readonly referenceNumber: string | null;
  readonly isLocked: boolean;
}

/** Ligne brute de la vue, avant remise en camelCase. */
interface RawRow {
  id: string | null;
  obligation_type_id: string | null;
  obligation_code: string | null;
  obligation_name: string | null;
  period_key: string | null;
  period_start: string | null;
  period_end: string | null;
  internal_due_date: string | null;
  legal_due_date: string | null;
  status: string | null;
  owner_id: string | null;
  owner_name: string | null;
  deputy_id: string | null;
  deputy_name: string | null;
  obligation_scope: string | null;
  commercial_register_id: string | null;
  register_number: string | null;
  register_label: string | null;
  register_status: string | null;
  validator_id: string | null;
  validator_name: string | null;
  documents_provided: number | null;
  documents_required: number | null;
  is_overdue: boolean | null;
  is_internally_late: boolean | null;
  days_to_internal: number | null;
  days_to_legal: number | null;
  criticality: string | null;
  periodicity: string | null;
  domain_id: string | null;
  domain_code: string | null;
  domain_label: string | null;
  authority_id: string | null;
  authority_name: string | null;
  rectification_index: number | null;
  rectifies_occurrence_id: string | null;
  reference_number: string | null;
  is_locked: boolean | null;
}

/**
 * Les colonnes d'une VUE sont toutes nullables pour supabase-js : PostgREST ne
 * publie pas de contrainte NOT NULL sur une vue. Le remappage rétablit donc les
 * valeurs par défaut plutôt que de propager des `null` sur des champs qui n'en
 * portent jamais en pratique.
 */
function toRow(raw: RawRow): OccurrenceListRow {
  return {
    id: raw.id ?? "",
    obligationTypeId: raw.obligation_type_id ?? "",
    obligationCode: raw.obligation_code ?? "",
    obligationName: raw.obligation_name ?? "",
    periodKey: raw.period_key ?? "",
    periodStart: raw.period_start ?? "",
    periodEnd: raw.period_end ?? "",
    internalDueDate: raw.internal_due_date ?? "",
    legalDueDate: raw.legal_due_date ?? "",
    status: raw.status ?? "TODO",
    ownerId: raw.owner_id,
    ownerName: raw.owner_name,
    deputyId: raw.deputy_id,
    deputyName: raw.deputy_name,
    obligationScope: raw.obligation_scope ?? "ENTITY",
    registerId: raw.commercial_register_id,
    registerNumber: raw.register_number,
    registerLabel: raw.register_label,
    registerStatus: raw.register_status,
    validatorId: raw.validator_id,
    validatorName: raw.validator_name,
    documentsProvided: raw.documents_provided ?? 0,
    documentsRequired: raw.documents_required ?? 0,
    isOverdue: raw.is_overdue ?? false,
    isInternallyLate: raw.is_internally_late ?? false,
    daysToInternal: raw.days_to_internal ?? 0,
    daysToLegal: raw.days_to_legal ?? 0,
    criticality: raw.criticality ?? "MEDIUM",
    periodicity: raw.periodicity ?? "MONTHLY",
    domainId: raw.domain_id,
    domainLabel: raw.domain_label,
    authorityName: raw.authority_name,
    rectificationIndex: raw.rectification_index ?? 0,
    referenceNumber: raw.reference_number,
    isLocked: raw.is_locked ?? false,
  };
}

// ─── Curseur ─────────────────────────────────────────────────────────────────

/**
 * Curseur opaque `valeur|id`, encodé en base64url.
 *
 * Jamais d'OFFSET : sur une liste triée par échéance, une occurrence qui change
 * d'état entre deux pages ferait sauter ou répéter des lignes. Le couple
 * (valeur triée, id) est unique et stable, ce qui rend la pagination exacte.
 */
interface DecodedCursor {
  readonly value: string;
  readonly id: string;
}

function encodeCursor(value: string, id: string): string {
  return Buffer.from(`${value}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): DecodedCursor | null {
  try {
    const [value, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    if (value === undefined || id === undefined || id.length === 0) return null;
    return { value, id };
  } catch {
    return null;
  }
}

function sortValueOf(row: OccurrenceListRow, column: OccurrenceFilters["sort"]): string {
  switch (column) {
    case "internal_due_date":
      return row.internalDueDate;
    case "legal_due_date":
      return row.legalDueDate;
    case "period_key":
      return row.periodKey;
    case "status":
      return row.status;
    case "obligation_code":
      return row.obligationCode;
    case "criticality":
      return row.criticality;
  }
}

// ─── Requête ─────────────────────────────────────────────────────────────────

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Requête de base sur la vue.
 *
 * ⚠️ Elle prend le client en ARGUMENT et n'est pas `async`. Un constructeur
 * PostgREST est un « thenable » : le rendre depuis une fonction asynchrone le
 * ferait exécuter à l'`await`, et TypeScript en déduirait le type de la RÉPONSE
 * au lieu de celui du constructeur. La chaîne de filtres devient alors
 * inexprimable.
 *
 * Sa forme sert aussi de TYPE aux fonctions qui l'enrichissent : la signature du
 * constructeur n'est pas recopiable à la main sans se périmer à la prochaine
 * mise à jour du client.
 */
function buildQuery(supabase: SupabaseClient) {
  return supabase.from("occurrence_list").select(LIST_COLUMNS);
}

type ListBuilder = ReturnType<typeof buildQuery>;

/** Applique les filtres. Extrait pour être partagé entre liste, calendrier et export. */
function applyFilters(
  query: ListBuilder,
  filters: OccurrenceFilters,
  currentUserId: ProfileId | null,
): ListBuilder {
  let next = query;

  if (filters.status !== undefined && filters.status.length > 0) {
    next = next.in("status", filters.status);
  }
  if (filters.domain !== undefined) next = next.eq("domain_id", filters.domain);
  if (filters.authority !== undefined) next = next.eq("authority_id", filters.authority);
  if (filters.owner !== undefined) next = next.eq("owner_id", filters.owner);
  if (filters.obligationType !== undefined) {
    next = next.eq("obligation_type_id", filters.obligationType);
  }

  if (filters.register !== undefined) {
    /*
     * ⚠️ « CE REGISTRE, OU TOUTE L'ENTREPRISE » — et non « ce registre ».
     *
     * Une obligation de portée ENTITY ne porte aucun registre : filtrer par
     * égalité la ferait DISPARAÎTRE dès qu'on sélectionne un établissement.
     * L'utilisateur verrait alors une liste courte et rassurante, amputée de la
     * TVA et des déclarations sociales, sans que rien ne le signale. C'est
     * l'interdiction explicite du cahier des charges, et c'est surtout la faute
     * la plus coûteuse : elle ne se découvre qu'au contrôle.
     */
    next = next.or(`commercial_register_id.eq.${filters.register},obligation_scope.eq.ENTITY`);
  }
  if (filters.criticality !== undefined) next = next.eq("criticality", filters.criticality);
  if (filters.overdue === true) next = next.eq("is_overdue", true);
  if (filters.internallyLate === true) next = next.eq("is_internally_late", true);
  if (filters.rectifications === true) next = next.gt("rectification_index", 0);
  if (filters.mine === true && currentUserId !== null) next = next.eq("owner_id", currentUserId);

  if (filters.period !== undefined && filters.period.length > 0) {
    // « 2026 » retient toute l'année, « 2026-01 » la seule période. Le préfixe
    // suffit : les clés de période sont construites pour se trier et se préfixer.
    next = next.like("period_key", `${filters.period}%`);
  }

  return next;
}

export async function listOccurrencePage(
  filters: OccurrenceFilters,
  currentUserId: ProfileId | null,
): Promise<Result<CursorPage<OccurrenceListRow>>> {
  const supabase = await createSupabaseServerClient();
  const ascending = filters.direction === "asc";
  let query = applyFilters(buildQuery(supabase), filters, currentUserId);

  if (filters.cursor !== undefined && filters.cursor.length > 0) {
    const decoded = decodeCursor(filters.cursor);
    if (decoded === null) {
      return err(AppError.validationFailed({ cursor: "CURSOR_MALFORMED" }));
    }
    const comparator = ascending ? "gt" : "lt";
    // « strictement après la valeur, OU même valeur et identifiant après » :
    // c'est ce qui rend la pagination exacte quand plusieurs lignes partagent
    // la même échéance.
    query = query.or(
      `${filters.sort}.${comparator}.${decoded.value},` +
        `and(${filters.sort}.eq.${decoded.value},id.${comparator}.${decoded.id})`,
    );
  }

  const { data, error } = await query
    .order(filters.sort, { ascending })
    // `id` ferme le tri : sans lui, deux lignes de même échéance ont un ordre
    // indéterminé et la pagination par curseur en saute ou en répète.
    .order("id", { ascending })
    // Une ligne de plus que demandé : sa présence signale qu'une page suivante
    // existe, sans exiger un COUNT sur toute la table.
    .limit(OCCURRENCE_PAGE_SIZE + 1);

  if (error !== null) return err(mapPostgrestError(error));

  const rows = data.map((row) => toRow(row as unknown as RawRow));
  const hasMore = rows.length > OCCURRENCE_PAGE_SIZE;
  const items = hasMore ? rows.slice(0, OCCURRENCE_PAGE_SIZE) : rows;
  const last = items.at(-1);

  return ok({
    items,
    nextCursor:
      hasMore && last !== undefined ? encodeCursor(sortValueOf(last, filters.sort), last.id) : null,
  });
}

/**
 * Historique d'un registre : SES occurrences, et elles seules.
 *
 * ⚠️ SÉMANTIQUE INVERSE DE CELLE DU FILTRE `register`, et il faut le savoir.
 *
 * Le filtre de l'échéancier est INCLUSIF — « ce registre OU toute l'entreprise »
 * — parce qu'un utilisateur qui regarde un établissement doit continuer de voir
 * la TVA. La FICHE d'un registre est EXCLUSIVE : elle décrit cet établissement,
 * et y mêler les obligations d'entreprise fausserait son taux de conformité en
 * lui attribuant des dossiers qui ne sont pas les siens.
 *
 * Les deux formes sont justes ; c'est la question posée qui diffère.
 */
export async function listRegisterOccurrences(
  registerId: string,
  filters: OccurrenceFilters,
  currentUserId: ProfileId | null,
): Promise<Result<CursorPage<OccurrenceListRow>>> {
  const supabase = await createSupabaseServerClient();

  /*
   * Le filtre INCLUSIF est neutralisé — `applyFilters` y ajouterait les
   * obligations d'entreprise — et l'égalité stricte est imposée à la place.
   */
  const exclusif: OccurrenceFilters = { ...filters, register: undefined };
  const scoped = applyFilters(
    buildQuery(supabase).eq("commercial_register_id", registerId),
    exclusif,
    currentUserId,
  );

  const { data, error } = await scoped
    .order(filters.sort, { ascending: filters.direction === "asc" })
    .order("id", { ascending: filters.direction === "asc" })
    // Un historique se lit en entier ; la borne protège d'un registre au volume
    // inattendu sans imposer une pagination là où l'on veut tout voir.
    .limit(500);

  if (error !== null) return err(mapPostgrestError(error));

  const rows = data.map((row) => toRow(row as unknown as RawRow));
  return ok({ items: rows, nextCursor: null });
}

/**
 * Occurrences d'une fenêtre de calendrier, en UNE requête.
 *
 * Positionnées à leur échéance INTERNE : c'est l'objectif que l'équipe se donne,
 * et donc la date à laquelle le travail doit apparaître au calendrier.
 */
export async function listCalendarWindow(
  from: string,
  to: string,
  filters: OccurrenceFilters,
  currentUserId: ProfileId | null,
): Promise<Result<readonly OccurrenceListRow[]>> {
  const supabase = await createSupabaseServerClient();
  const scoped = buildQuery(supabase).gte("internal_due_date", from).lte("internal_due_date", to);

  // Borne haute : un intervalle très large ne doit pas rapatrier la base entière.
  const { data, error } = await applyFilters(scoped, filters, currentUserId)
    .order("internal_due_date", { ascending: true })
    .order("id", { ascending: true })
    .limit(2000);

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data.map((row) => toRow(row as unknown as RawRow)));
}

/**
 * Extraction pour l'export. Bornée : un export n'est pas un dump de base.
 * Au-delà de la borne, l'utilisateur doit affiner ses filtres — et l'écran le dit.
 */
export const EXPORT_ROW_LIMIT = 5000;

export async function listForExport(
  filters: OccurrenceFilters,
  currentUserId: ProfileId | null,
): Promise<Result<readonly OccurrenceListRow[]>> {
  const supabase = await createSupabaseServerClient();
  const query = applyFilters(buildQuery(supabase), filters, currentUserId);

  const { data, error } = await query
    .order(filters.sort, { ascending: filters.direction === "asc" })
    .order("id", { ascending: true })
    .limit(EXPORT_ROW_LIMIT);

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data.map((row) => toRow(row as unknown as RawRow)));
}

// ─── Agrégats ────────────────────────────────────────────────────────────────

export interface OccurrenceStatRow {
  readonly domainId: string | null;
  readonly status: string;
  readonly total: number;
  readonly overdue: number;
  readonly internallyLate: number;
  readonly dueWithinWeek: number;
  readonly dueWithinMonth: number;
}

/**
 * ⚠️ Aucun COUNT sur la table complète. Les agrégats viennent de la vue
 * matérialisée, rafraîchie toutes les 15 minutes, et filtrée par domaine dans
 * `occurrence_stats_for_caller()`.
 */
export async function getOccurrenceStats(): Promise<Result<readonly OccurrenceStatRow[]>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("occurrence_stats_for_caller");
  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      domainId: row.domain_id,
      status: row.status,
      total: row.total,
      overdue: row.overdue,
      internallyLate: row.internally_late,
      dueWithinWeek: row.due_within_week,
      dueWithinMonth: row.due_within_month,
    })),
  );
}
