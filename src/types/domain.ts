/**
 * Types métier, DÉRIVÉS des types générés par Supabase. Jamais réécrits à la main :
 * une forme recopiée diverge du schéma au premier ALTER TABLE, et le compilateur
 * ne le voit pas.
 *
 * Le schéma Postgres est la source de vérité. Les énumérations applicatives de
 * `src/config/constants.ts` lui sont confrontées plus bas ; toute divergence casse
 * `npm run typecheck`.
 */

import type { Criticality, OccurrenceStatus, Periodicity } from "@/config/constants";
import type { Database } from "@/types/database.types";

type PublicSchema = Database["public"];
type PublicTables = PublicSchema["Tables"];
type PublicViews = PublicSchema["Views"];
type PublicEnums = PublicSchema["Enums"];

/** Ligne lue d'une table. */
export type Tables<TName extends keyof PublicTables> = PublicTables[TName] extends {
  Row: infer TRow;
}
  ? TRow
  : never;

/** Payload d'insertion d'une table. */
export type TablesInsert<TName extends keyof PublicTables> = PublicTables[TName] extends {
  Insert: infer TInsert;
}
  ? TInsert
  : never;

/** Payload de mise à jour d'une table. */
export type TablesUpdate<TName extends keyof PublicTables> = PublicTables[TName] extends {
  Update: infer TUpdate;
}
  ? TUpdate
  : never;

export type Views<TName extends keyof PublicViews> = PublicViews[TName] extends {
  Row: infer TRow;
}
  ? TRow
  : never;

export type Enums<TName extends keyof PublicEnums> = PublicEnums[TName];

// ─── Identifiants brandés ────────────────────────────────────────────────────

/**
 * Tous les identifiants du domaine sont des `uuid`, donc des `string`. Pour le
 * compilateur, passer un identifiant de document là où une occurrence est attendue
 * est parfaitement légal — et le bug ne se voit qu'à l'exécution, sur une requête
 * qui rend zéro ligne.
 *
 * Le marquage rend cette confusion impossible à écrire. Le coût est un appel à
 * `toOccurrenceId()` à la frontière ; le bénéfice est qu'aucune permutation
 * d'arguments ne peut plus compiler.
 */
declare const brand: unique symbol;
type Branded<TBrand extends string> = string & { readonly [brand]: TBrand };

export type EntityId = Branded<"EntityId">;
export type ProfileId = Branded<"ProfileId">;
export type DomainId = Branded<"DomainId">;
export type DepartmentId = Branded<"DepartmentId">;
export type AuthorityId = Branded<"AuthorityId">;
export type ObligationTypeId = Branded<"ObligationTypeId">;
export type OccurrenceId = Branded<"OccurrenceId">;
export type DocumentId = Branded<"DocumentId">;
export type ChecklistItemId = Branded<"ChecklistItemId">;
export type RoleId = Branded<"RoleId">;
export type UserRoleId = Branded<"UserRoleId">;
export type DelegationId = Branded<"DelegationId">;

/**
 * Fabriques. Volontairement sans validation de forme : ce sont des conversions de
 * frontière, pas des garde-fous. La validation d'un uuid reçu de l'extérieur est
 * le travail de Zod, à l'entrée de la Server Action.
 */
export const toEntityId = (value: string): EntityId => value as EntityId;
export const toProfileId = (value: string): ProfileId => value as ProfileId;
export const toDomainId = (value: string): DomainId => value as DomainId;
export const toDepartmentId = (value: string): DepartmentId => value as DepartmentId;
export const toAuthorityId = (value: string): AuthorityId => value as AuthorityId;
export const toObligationTypeId = (value: string): ObligationTypeId => value as ObligationTypeId;
export const toOccurrenceId = (value: string): OccurrenceId => value as OccurrenceId;
export const toDocumentId = (value: string): DocumentId => value as DocumentId;
export const toChecklistItemId = (value: string): ChecklistItemId => value as ChecklistItemId;
export const toRoleId = (value: string): RoleId => value as RoleId;
export const toUserRoleId = (value: string): UserRoleId => value as UserRoleId;
export const toDelegationId = (value: string): DelegationId => value as DelegationId;

// ─── Lignes de base ──────────────────────────────────────────────────────────

export type EntityRow = Tables<"entities">;
export type DepartmentRow = Tables<"departments">;
export type ProfileRow = Tables<"profiles">;
export type DomainRow = Tables<"domains">;
export type AuthorityRow = Tables<"authorities">;
export type HolidayRow = Tables<"holidays">;
export type ObligationTypeRow = Tables<"obligation_types">;
export type RequiredDocumentRow = Tables<"obligation_required_documents">;
export type OccurrenceRow = Tables<"obligation_occurrences">;
export type ChecklistItemRow = Tables<"occurrence_checklist_items">;
export type TransitionRow = Tables<"occurrence_transitions">;
export type CommentRow = Tables<"occurrence_comments">;
export type DocumentRow = Tables<"documents">;
export type RoleRow = Tables<"roles">;
export type UserRoleRow = Tables<"user_roles">;
export type DelegationRow = Tables<"validation_delegations">;
export type StatusTransitionRuleRow = Tables<"status_transition_rules">;

// ─── Types composés ──────────────────────────────────────────────────────────

/** Occurrence accompagnée de son obligation : le strict nécessaire d'une ligne de liste. */
export interface OccurrenceWithType {
  readonly occurrence: OccurrenceRow;
  readonly obligationType: Pick<
    ObligationTypeRow,
    "id" | "code" | "name" | "periodicity" | "criticality" | "domain_id"
  >;
  readonly domain: Pick<DomainRow, "id" | "code" | "label"> | null;
}

export interface OccurrenceWithDocuments {
  readonly occurrence: OccurrenceRow;
  readonly documents: readonly DocumentRow[];
}

export interface ObligationTypeWithRequirements {
  readonly obligationType: ObligationTypeRow;
  readonly requiredDocuments: readonly RequiredDocumentRow[];
}

/** Vue complète d'un dossier : ce que charge l'écran de détail, en une fois. */
export interface OccurrenceDetail {
  readonly occurrence: OccurrenceRow;
  readonly obligationType: ObligationTypeRow;
  readonly domain: DomainRow | null;
  readonly authority: Pick<AuthorityRow, "id" | "code" | "name" | "portal_url"> | null;
  readonly owner: Pick<ProfileRow, "id" | "full_name"> | null;
  readonly validator: Pick<ProfileRow, "id" | "full_name"> | null;
  readonly checklist: readonly ChecklistItemRow[];
  readonly documents: readonly DocumentRow[];
  readonly transitions: readonly TransitionRow[];
}

// ─── Pagination par curseur ──────────────────────────────────────────────────

/**
 * Curseur opaque plutôt qu'un OFFSET : sur une liste triée par échéance, un OFFSET
 * saute ou répète des lignes dès qu'une occurrence change d'état entre deux pages.
 */
export interface CursorPage<T> {
  readonly items: readonly T[];
  /** `null` quand la dernière page est atteinte. */
  readonly nextCursor: string | null;
}

export interface CursorParams {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

// ─── Contrats énumération applicative ↔ ENUM Postgres ────────────────────────

/** `true` si les deux unions sont rigoureusement identiques, `false` sinon. */
type IsSameUnion<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * Échoue à la compilation dès que `T` n'est pas `true`.
 * La contrainte porte sur `false`, pas sur `never` : `never` est assignable à tout,
 * un test rendant `never` n'aurait donc jamais rien cassé.
 */
type Assert<T extends true> = T;

export type OccurrenceStatusMatchesDatabase = Assert<
  IsSameUnion<OccurrenceStatus, Enums<"occurrence_status">>
>;

export type PeriodicityMatchesDatabase = Assert<IsSameUnion<Periodicity, Enums<"periodicity">>>;

export type CriticalityMatchesDatabase = Assert<IsSameUnion<Criticality, Enums<"criticality">>>;
