/**
 * `Result<T, E>` — type de retour de toute la couche services (cf. CLAUDE.md §3.3).
 *
 * L'appelant traite explicitement les deux branches. Pas de `result.value!`,
 * pas de `throw` pour une erreur attendue.
 */

import type { AppError } from "@/lib/errors";

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export type Result<T, E = AppError> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E = AppError>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

/** Transforme la valeur d'un succès, propage l'erreur inchangée. */
export function mapResult<T, U, E>(result: Result<T, E>, transform: (value: T) => U): Result<U, E> {
  return result.ok ? ok(transform(result.value)) : result;
}

/** Enchaîne une opération qui peut elle-même échouer. */
export function flatMapResult<T, U, E>(
  result: Result<T, E>,
  transform: (value: T) => Result<U, E>,
): Result<U, E> {
  return result.ok ? transform(result.value) : result;
}

/** Transforme l'erreur d'un échec, propage la valeur inchangée. */
export function mapError<T, E, F>(result: Result<T, E>, transform: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(transform(result.error));
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/**
 * Agrège une liste de `Result` : premier échec rencontré, sinon toutes les valeurs.
 */
export function collectResults<T, E>(results: readonly Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) return result;
    values.push(result.value);
  }
  return ok(values);
}
