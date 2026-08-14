/**
 * Types métier, dérivés des types générés par Supabase.
 *
 * Le schéma Postgres est la source de vérité. Les énumérations applicatives de
 * `src/config/constants.ts` sont confrontées ici à celles de la base : toute
 * divergence casse le typecheck au lieu de produire un bug silencieux.
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

/** `true` si les deux unions sont rigoureusement identiques, `false` sinon. */
type IsSameUnion<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * Échoue à la compilation dès que `T` n'est pas `true`.
 *
 * La contrainte doit porter sur `false`, pas sur `never` : `never` est assignable
 * à tout, un `AssertSameUnion` rendant `never` n'aurait donc jamais rien cassé.
 */
type Assert<T extends true> = T;

/**
 * Contrats énumération applicative ↔ ENUM Postgres.
 * Si une migration modifie un type ENUM sans que `src/config/constants.ts` suive
 * (ou l'inverse), `npm run typecheck` échoue sur la ligne concernée.
 */
export type OccurrenceStatusMatchesDatabase = Assert<
  IsSameUnion<OccurrenceStatus, Enums<"occurrence_status">>
>;

export type PeriodicityMatchesDatabase = Assert<IsSameUnion<Periodicity, Enums<"periodicity">>>;

export type CriticalityMatchesDatabase = Assert<IsSameUnion<Criticality, Enums<"criticality">>>;
