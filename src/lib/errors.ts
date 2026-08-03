/**
 * Erreurs applicatives.
 *
 * Un service ne lève jamais d'exception métier : il retourne `Err<AppError>`
 * (cf. CLAUDE.md §3.3). Les exceptions restent réservées aux bugs de programmation.
 *
 * `messageKey` est une clé i18n, jamais un message rédigé : aucune chaîne visible
 * par l'utilisateur ne doit être écrite ici.
 */

export const APP_ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION",
  "CONFLICT",
  "INVALID_TRANSITION",
  "PRECONDITION_FAILED",
  "STORAGE",
  "DATABASE",
  "RATE_LIMITED",
  "UNEXPECTED",
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

export interface AppError {
  readonly code: AppErrorCode;
  /** Clé i18n résolue à l'affichage. Jamais un texte en clair. */
  readonly messageKey: string;
  /** Contexte structuré destiné aux logs et à l'audit. */
  readonly details?: Readonly<Record<string, unknown>>;
  /** Cause d'origine, conservée côté serveur. Ne doit jamais atteindre le client. */
  readonly cause?: unknown;
}

export interface AppErrorOptions {
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

export function appError(
  code: AppErrorCode,
  messageKey: string,
  options?: AppErrorOptions,
): AppError {
  if (options === undefined) {
    return { code, messageKey };
  }
  const { details, cause } = options;
  return {
    code,
    messageKey,
    ...(details === undefined ? {} : { details }),
    ...(cause === undefined ? {} : { cause }),
  };
}

export function isAppError(value: unknown): value is AppError {
  if (typeof value !== "object" || value === null) return false;
  const candidate: Record<string, unknown> = { ...value };
  return (
    typeof candidate["messageKey"] === "string" &&
    APP_ERROR_CODES.some((code) => code === candidate["code"])
  );
}

/**
 * Convertit une valeur interceptée dans un `catch` en `AppError`.
 * À utiliser à la frontière de la couche data, jamais pour masquer un bug.
 */
export function toAppError(value: unknown, messageKey = "errors.unexpected"): AppError {
  if (isAppError(value)) return value;
  return appError("UNEXPECTED", messageKey, { cause: value });
}
