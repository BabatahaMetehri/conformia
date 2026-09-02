/**
 * Taxonomie d'erreurs applicatives.
 *
 * Un service ne lève jamais d'`AppError` : il la retourne dans un `Err`
 * (cf. CLAUDE.md §3.3). La classe étend `Error` uniquement pour conserver une
 * pile d'appels exploitable côté serveur.
 *
 * `message` est une CLÉ i18n, jamais un texte rédigé.
 */

// ─── Codes ───────────────────────────────────────────────────────────────────

export const AppErrorCode = {
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  CONFLICT: "CONFLICT",
  PERIOD_LOCKED: "PERIOD_LOCKED",
  INVALID_TRANSITION: "INVALID_TRANSITION",
  STORAGE_FAILED: "STORAGE_FAILED",
  INTEGRITY_CHECK_FAILED: "INTEGRITY_CHECK_FAILED",
  RATE_LIMITED: "RATE_LIMITED",
  EXTERNAL_SERVICE_FAILED: "EXTERNAL_SERVICE_FAILED",
  INTERNAL: "INTERNAL",
} as const;

export type AppErrorCode = (typeof AppErrorCode)[keyof typeof AppErrorCode];

export const HTTP_STATUS_BY_CODE: Readonly<Record<AppErrorCode, number>> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  CONFLICT: 409,
  PERIOD_LOCKED: 423,
  INVALID_TRANSITION: 409,
  STORAGE_FAILED: 502,
  INTEGRITY_CHECK_FAILED: 422,
  RATE_LIMITED: 429,
  EXTERNAL_SERVICE_FAILED: 502,
  INTERNAL: 500,
};

/**
 * Codes dont le `details` ne sort jamais du serveur : il ne contient que du
 * diagnostic d'infrastructure, sans valeur pour l'utilisateur.
 */
const OPAQUE_DETAIL_CODES: ReadonlySet<AppErrorCode> = new Set([AppErrorCode.INTERNAL]);

export type ErrorDetails = Readonly<Record<string, unknown>>;

export interface AppErrorOptions {
  readonly details?: ErrorDetails;
  readonly cause?: unknown;
  /** Ne surcharger que si le code par défaut ne convient pas au contexte HTTP. */
  readonly httpStatus?: number;
}

// ─── Classe ──────────────────────────────────────────────────────────────────

export class AppError extends Error {
  override readonly name = "AppError";
  readonly code: AppErrorCode;
  readonly httpStatus: number;
  /**
   * Contexte structuré. Déclaré `| undefined` plutôt qu'optionnel pour rester
   * compatible avec `exactOptionalPropertyTypes`.
   */
  readonly details: ErrorDetails | undefined;

  constructor(code: AppErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.httpStatus = options.httpStatus ?? HTTP_STATUS_BY_CODE[code];
    this.details = options.details;
  }

  // ── Constructeurs nommés ───────────────────────────────────────────────────

  static unauthenticated(options?: AppErrorOptions): AppError {
    return new AppError(AppErrorCode.UNAUTHENTICATED, "errors.unauthenticated", options);
  }

  static forbidden(options?: AppErrorOptions): AppError {
    return new AppError(AppErrorCode.FORBIDDEN, "errors.forbidden", options);
  }

  static notFound(entity: string, id: string, options?: AppErrorOptions): AppError {
    return new AppError(AppErrorCode.NOT_FOUND, "errors.notFound", {
      ...options,
      details: { ...options?.details, entity, id },
    });
  }

  static validationFailed(details: ErrorDetails, options?: AppErrorOptions): AppError {
    return new AppError(AppErrorCode.VALIDATION_FAILED, "errors.validationFailed", {
      ...options,
      details: { ...options?.details, ...details },
    });
  }

  static conflict(options?: AppErrorOptions): AppError {
    return new AppError(AppErrorCode.CONFLICT, "errors.conflict", options);
  }

  /**
   * La période comptable est close : plus aucune écriture n'est acceptée.
   * Le champ est nommé `period` et non `periodKey` : le logger masque tout champ
   * dont le nom contient le mot « key ».
   */
  static periodLocked(periodKey: string, options?: AppErrorOptions): AppError {
    return new AppError(AppErrorCode.PERIOD_LOCKED, "errors.periodLocked", {
      ...options,
      details: { ...options?.details, period: periodKey },
    });
  }

  /** Transition d'état refusée par la machine à états. */
  static invalidTransition(from: string, to: string, options?: AppErrorOptions): AppError {
    return new AppError(AppErrorCode.INVALID_TRANSITION, "errors.invalidTransition", {
      ...options,
      details: { ...options?.details, from, to },
    });
  }

  static storageFailed(operation: string, options?: AppErrorOptions): AppError {
    return new AppError(AppErrorCode.STORAGE_FAILED, "errors.storageFailed", {
      ...options,
      details: { ...options?.details, operation },
    });
  }

  /** L'empreinte recalculée d'un document ne correspond plus à celle enregistrée. */
  static integrityCheckFailed(documentId: string, options?: AppErrorOptions): AppError {
    return new AppError(AppErrorCode.INTEGRITY_CHECK_FAILED, "errors.integrityCheckFailed", {
      ...options,
      details: { ...options?.details, documentId },
    });
  }

  static rateLimited(retryAfterSeconds: number, options?: AppErrorOptions): AppError {
    return new AppError(AppErrorCode.RATE_LIMITED, "errors.rateLimited", {
      ...options,
      details: { ...options?.details, retryAfterSeconds },
    });
  }

  static externalServiceFailed(service: string, options?: AppErrorOptions): AppError {
    return new AppError(AppErrorCode.EXTERNAL_SERVICE_FAILED, "errors.externalServiceFailed", {
      ...options,
      details: { ...options?.details, service },
    });
  }

  static internal(options?: AppErrorOptions): AppError {
    return new AppError(AppErrorCode.INTERNAL, "errors.internal", options);
  }

  /** Normalise une valeur interceptée dans un `catch`. */
  static from(value: unknown): AppError {
    if (value instanceof AppError) return value;
    return AppError.internal({ cause: value });
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

// ─── Projection vers le client ───────────────────────────────────────────────

export interface ClientError {
  readonly code: AppErrorCode;
  /** Clé i18n. */
  readonly message: string;
  readonly httpStatus: number;
  readonly details?: ErrorDetails;
}

/**
 * Projette une `AppError` vers un objet sérialisable destiné au client.
 *
 * Deux garanties, dans cet ordre d'importance :
 *  1. `cause` n'est JAMAIS sérialisée. Elle contient des erreurs Postgres, des
 *     chemins de fichiers, parfois des fragments de requête. Aucune exception,
 *     quel que soit le code — la règle du §6 ne se négocie pas au cas par cas.
 *  2. `details` est retiré pour les codes opaques (INTERNAL).
 *
 * Corollaire pour les appelants : ne placez jamais d'information d'infrastructure
 * dans `details` d'un code non opaque, elle atteindrait le navigateur.
 */
export function toClientError(error: AppError): ClientError {
  const base = {
    code: error.code,
    message: error.message,
    httpStatus: error.httpStatus,
  } satisfies Omit<ClientError, "details">;

  if (error.details === undefined || OPAQUE_DETAIL_CODES.has(error.code)) {
    return base;
  }
  return { ...base, details: scrubDetails(error.details) };
}

/**
 * Motifs qui n'ont RIEN à faire dans une réponse.
 *
 * ⚠️ Le commentaire ci-dessus disait « ne placez jamais d'information
 * d'infrastructure dans `details` ». C'était une consigne, donc quelque chose
 * qu'on finit par oublier un vendredi. Ceci en fait une garantie.
 *
 * Les trois familles visées se reconnaissent sans ambiguïté :
 *  • une trace de pile — `at fn (/chemin/fichier.ts:12:3)` ;
 *  • un fragment SQL — un verbe suivi d'une clause ;
 *  • un chemin serveur — absolu POSIX, lettre de lecteur Windows, node_modules.
 */
const LEAKY_PATTERNS: readonly RegExp[] = [
  // Trace de pile : « at fn (/chemin/fichier.ts:12:3) ».
  /\bat\s+\S*\s*\(?[^\s)]+:\d+:\d+\)?/i,
  // Fragment SQL : un verbe suivi de sa clause.
  /\b(select|insert\s+into|update|delete\s+from|alter\s+table|create\s+table)\b[\s\S]*\b(from|into|set|where|values)\b/i,
  // Chemin serveur POSIX : racine système courante.
  /(^|[\s\"'`(])\/(?:home|var|usr|srv|etc|root|tmp)\//,
  // Nom d'objet Postgres : schéma qualifié, ou catalogue système.
  /\bpg_[a-z_]{2,}\b|\bpublic\.[a-z_]{2,}\b/i,
];

/**
 * Marqueurs testés par simple inclusion.
 *
 * ⚠️ La barre oblique INVERSE est construite par `String.fromCharCode(92)` et
 * non écrite littéralement. Ce fichier a traversé plusieurs réécritures
 * automatiques pendant lesquelles une classe de caractères `[<barre>/]` a perdu
 * sa barre à chaque passage — le motif compilait toujours, et ne détectait plus
 * les chemins Windows. Un test l'a rattrapé ; la construction ci-dessous
 * l'empêche de recommencer.
 */
const BACKSLASH = String.fromCharCode(92);
const LEAKY_SUBSTRINGS: readonly string[] = [`node_modules${BACKSLASH}`, "node_modules/"];

/** Chemin Windows : une lettre de lecteur suivie d'un séparateur. */
const WINDOWS_PATH = new RegExp(`[A-Za-z]:[${BACKSLASH}${BACKSLASH}/]`);

/** Ce qui remplace une valeur suspecte. Explicite : on veut le voir en test. */
export const SCRUBBED = "[omis]";

function looksLeaky(value: string): boolean {
  if (WINDOWS_PATH.test(value)) return true;
  if (LEAKY_SUBSTRINGS.some((marker) => value.includes(marker))) return true;
  return LEAKY_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Retire d'un objet de détail tout ce qui ressemble à de l'infrastructure.
 *
 * ⚠️ Récursif et borné en profondeur : un détail imbriqué à cinq niveaux est
 * déjà anormal, et une structure cyclique ferait boucler la sérialisation avant
 * même d'atteindre le client.
 */
function scrubValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") return looksLeaky(value) ? SCRUBBED : value;
  if (typeof value === "object" && value !== null) {
    return scrubDetails(value as ErrorDetails, depth + 1);
  }
  return value;
}

export function scrubDetails(details: ErrorDetails, depth = 0): ErrorDetails {
  if (depth > 4) return {};

  const clean: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(details)) {
    if (typeof value === "string") {
      clean[key] = looksLeaky(value) ? SCRUBBED : value;
      continue;
    }

    if (Array.isArray(value)) {
      // `unknown[]` explicite : `Array.isArray` ne rétrécit qu'en `any[]`, et
      // la valeur ressortirait alors non typée du `map`.
      const items: unknown[] = value;
      clean[key] = items.map((item) => scrubValue(item, depth));
      continue;
    }

    if (typeof value === "object" && value !== null) {
      clean[key] = scrubDetails(value as ErrorDetails, depth + 1);
      continue;
    }

    clean[key] = value;
  }

  return clean;
}

// ─── Traduction des erreurs Postgres / PostgREST ─────────────────────────────

interface PostgrestLikeError {
  readonly code: string;
  readonly message: string;
  readonly details: string | undefined;
  readonly hint: string | undefined;
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

function asPostgrestError(value: unknown): PostgrestLikeError | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const source: Record<string, unknown> = { ...value };
  const code = readString(source, "code");
  if (code === undefined) return undefined;
  return {
    code,
    message: readString(source, "message") ?? "",
    details: readString(source, "details"),
    hint: readString(source, "hint"),
  };
}

/**
 * Codes SQLSTATE et codes PostgREST → codes applicatifs.
 * Tout ce qui n'est pas listé est un INTERNAL : une erreur non classée est un
 * bug de notre côté, pas une erreur utilisateur à afficher.
 */
const APP_CODE_BY_DB_CODE: Readonly<Record<string, AppErrorCode>> = {
  // PostgREST
  PGRST116: AppErrorCode.NOT_FOUND, // aucune ligne pour .single()
  PGRST301: AppErrorCode.UNAUTHENTICATED, // JWT expiré ou invalide
  // Contraintes d'intégrité
  "23505": AppErrorCode.CONFLICT, // unique_violation
  "23503": AppErrorCode.CONFLICT, // foreign_key_violation
  "23502": AppErrorCode.VALIDATION_FAILED, // not_null_violation
  "23514": AppErrorCode.VALIDATION_FAILED, // check_violation
  "22P02": AppErrorCode.VALIDATION_FAILED, // invalid_text_representation
  "22001": AppErrorCode.VALIDATION_FAILED, // string_data_right_truncation
  // Droits
  "42501": AppErrorCode.FORBIDDEN, // insufficient_privilege (RLS, GRANT)
  "28000": AppErrorCode.UNAUTHENTICATED, // invalid_authorization_specification
  // Concurrence
  "40001": AppErrorCode.CONFLICT, // serialization_failure
  "40P01": AppErrorCode.CONFLICT, // deadlock_detected
  // Règle métier levée par un trigger (RAISE EXCEPTION)
  P0001: AppErrorCode.CONFLICT,
};

/**
 * Traduit une erreur PostgREST/Postgres en `AppError`.
 * Le message d'origine part dans `cause`, donc jamais vers le client.
 */
export function mapPostgrestError(value: unknown): AppError {
  const dbError = asPostgrestError(value);
  if (dbError === undefined) {
    return AppError.internal({ cause: value });
  }

  const code = APP_CODE_BY_DB_CODE[dbError.code] ?? AppErrorCode.INTERNAL;
  const messageKey = MESSAGE_KEY_BY_CODE[code];

  return new AppError(code, messageKey, {
    // `dbCode` reste exploitable en log et en audit ; il est retiré du payload
    // client pour INTERNAL par `toClientError`.
    details: { dbCode: dbError.code },
    cause: value,
  });
}

const MESSAGE_KEY_BY_CODE: Readonly<Record<AppErrorCode, string>> = {
  UNAUTHENTICATED: "errors.unauthenticated",
  FORBIDDEN: "errors.forbidden",
  NOT_FOUND: "errors.notFound",
  VALIDATION_FAILED: "errors.validationFailed",
  CONFLICT: "errors.conflict",
  PERIOD_LOCKED: "errors.periodLocked",
  INVALID_TRANSITION: "errors.invalidTransition",
  STORAGE_FAILED: "errors.storageFailed",
  INTEGRITY_CHECK_FAILED: "errors.integrityCheckFailed",
  RATE_LIMITED: "errors.rateLimited",
  EXTERNAL_SERVICE_FAILED: "errors.externalServiceFailed",
  INTERNAL: "errors.internal",
};
