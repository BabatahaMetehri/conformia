/**
 * Types métier, dérivés des types générés par Supabase.
 *
 * Rien n'est redéclaré à la main ici : le schéma Postgres est la source de vérité.
 * Si une valeur disparaît de la base, la compilation casse — c'est l'intérêt.
 */

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
 * Cycle de vie d'une occurrence. L'ensemble des statuts est structurel ;
 * les TRANSITIONS autorisées sont des données en base, pas un `switch` (CLAUDE.md §1).
 */
export type OccurrenceStatus = Enums<"occurrence_status">;

/**
 * Miroir exécutable de l'énumération, vérifié contre le type généré.
 * Un statut ajouté en base sans être listé ici ne fera pas planter la compilation ;
 * un statut listé ici mais absent de la base, si.
 */
export const OCCURRENCE_STATUSES = [
  "TODO",
  "IN_PROGRESS",
  "PENDING_VALIDATION",
  "VALIDATED",
  "SUBMITTED",
  "ARCHIVED",
  "REJECTED",
  "NOT_APPLICABLE",
] as const satisfies readonly OccurrenceStatus[];
