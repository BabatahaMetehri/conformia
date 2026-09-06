/**
 * Contrats de retour des actions d'administration.
 *
 * Déclarés HORS d'un module « use server » : un tel fichier ne peut exporter que
 * des fonctions asynchrones. Y placer un type compile sans broncher, puis échoue
 * à la première requête.
 */

import type { ClientError } from "@/lib/errors";

export type AdminOutcome<T> =
  | { readonly status: "success"; readonly data: T }
  | { readonly status: "error"; readonly error: ClientError };

export type PlainAdminOutcome = AdminOutcome<null>;
export type CountOutcome = AdminOutcome<number>;
export type IdOutcome = AdminOutcome<{ readonly id: string }>;

/** Résultat d'un import de jours fériés : ce qui est entré, ce qui a été rejeté. */
export type HolidayImportOutcome = AdminOutcome<{
  readonly imported: number;
  readonly rejectedLines: readonly number[];
  readonly recalculated: number;
}>;

/**
 * L'impact ANNONCÉ d'un changement de calendrier, avant qu'il soit appliqué.
 *
 * `rejectedLines` n'est renseigné que pour un import : autant montrer les lignes
 * illisibles pendant qu'on peut encore corriger le fichier, plutôt qu'après les
 * avoir avalées.
 */
export type HolidayImpactOutcome = AdminOutcome<{
  readonly moved: number;
  readonly examined: number;
  readonly importable: number;
  readonly rejectedLines: readonly number[];
}>;

export type CsvOutcome = AdminOutcome<{
  readonly csv: string;
  readonly rowCount: number;
  readonly filename: string;
}>;
