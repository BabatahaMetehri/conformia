/**
 * Types métier, dérivés des types générés par Supabase.
 *
 * Le schéma Postgres est la source de vérité. Les énumérations applicatives de
 * `src/config/constants.ts` sont confrontées ici à celles de la base : toute
 * divergence casse le typecheck au lieu de produire un bug silencieux.
 */

import type { OccurrenceStatus } from "@/config/constants";
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

/**
 * Vaut `true` si les deux unions sont rigoureusement identiques, `never` sinon.
 * Un `never` rend l'alias inutilisable et fait échouer `tsc`.
 */
type AssertSameUnion<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

/**
 * Contrat énumération applicative ↔ ENUM Postgres.
 * Si la migration change `occurrence_status` sans que `src/config/constants.ts`
 * suive (ou l'inverse), ce type devient `never` et le typecheck échoue.
 */
export type OccurrenceStatusMatchesDatabase = AssertSameUnion<
  OccurrenceStatus,
  Enums<"occurrence_status">
>;
