/**
 * `Result<T, E>` — type de retour de toute la couche services (cf. CLAUDE.md §3.3).
 *
 * L'appelant traite explicitement les deux branches. Pas de `result.value!`,
 * pas de `throw` pour une erreur attendue.
 */

import { AppError } from "@/lib/errors";

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

/**
 * Enchaîne une opération qui peut elle-même échouer.
 * Primitive de composition des services : `A → B → C` sans imbrication de `if`.
 */
export function flatMapResult<T, U, E>(
  result: Result<T, E>,
  transform: (value: T) => Result<U, E>,
): Result<U, E> {
  return result.ok ? transform(result.value) : result;
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/**
 * Enveloppe une opération qui peut lever ou rejeter.
 *
 * Accepte une promesse **ou** une fonction : la forme fonction est la seule qui
 * capture aussi une exception levée de façon synchrone avant que la promesse
 * n'existe. Préférez-la partout où l'appel peut échouer immédiatement.
 */
export async function tryCatch<T>(
  source: Promise<T> | (() => T | Promise<T>),
  // Enveloppé dans une lambda plutôt que passé en référence : `AppError.from`
  // détachée de sa classe déclencherait `@typescript-eslint/unbound-method`.
  onError: (error: unknown) => AppError = (error) => AppError.from(error),
): Promise<Result<T>> {
  try {
    const value = typeof source === "function" ? await source() : await source;
    return ok(value);
  } catch (error) {
    return err(onError(error));
  }
}

/**
 * Agrège un tableau de `Result` en un `Result` de tableau.
 * S'arrête au premier échec : l'ordre des entrées détermine l'erreur retournée.
 */
export function collect<T, E>(results: readonly Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) return result;
    values.push(result.value);
  }
  return ok(values);
}
