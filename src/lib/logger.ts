/**
 * Journalisation structurée.
 *
 * Production : une ligne JSON par événement, collectée par l'hébergeur.
 * Développement : sortie colorée lisible.
 *
 * Ce module lit `process.env` directement plutôt que `@/config/env` : la
 * validation d'environnement doit pouvoir échouer en se faisant entendre, sans
 * dépendre d'un logger qui dépendrait d'elle.
 *
 * Les documents traités sont sensibles : `redact()` s'applique à TOUT contexte,
 * à n'importe quelle profondeur, avant écriture. Ne jamais journaliser le contenu
 * d'un document, seulement son identifiant.
 */

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogContext = Readonly<Record<string, unknown>>;

const LEVEL_WEIGHT: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

// ─── Masquage ────────────────────────────────────────────────────────────────

/**
 * Mots déclenchant le masquage d'un champ, comparés mot à mot après découpage
 * du nom de clé (`camelCase`, `snake_case`, `kebab-case`).
 *
 * ⚠️ `key` en fait partie : un champ nommé `foreignKey` ou `idempotencyKey` SERA
 * masqué. C'est le sens d'erreur voulu — sur-masquer coûte du confort de debug,
 * sous-masquer coûte une fuite. Nommer `period`, `reference` ou `id` les champs
 * non secrets.
 */
const SENSITIVE_WORDS: ReadonlySet<string> = new Set([
  "password",
  "passwd",
  "pwd",
  "passe",
  "token",
  "key",
  "keys",
  "apikey",
  "secret",
  "authorization",
  "auth",
  "cookie",
  "cookies",
  "credential",
  "credentials",
  "signature",
  "jwt",
  "bearer",
  "session",
]);

export const REDACTED = "[redacted]";

const MAX_DEPTH = 8;

function splitKeyWords(key: string): readonly string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}

function isSensitiveKey(key: string): boolean {
  return splitKeyWords(key).some((word) => SENSITIVE_WORDS.has(word));
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (depth > MAX_DEPTH) return "[max-depth]";
  if (value === null || typeof value !== "object") return value;

  // Objets déjà sérialisables : les parcourir les réduirait à `{}`, faute de
  // propriétés énumérables propres.
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { name: value.name, message: value.message };

  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1, seen));
  }
  if (value instanceof Map) {
    return redactEntries([...value.entries()], depth, seen);
  }
  if (value instanceof Set) {
    return [...value].map((item) => redactValue(item, depth + 1, seen));
  }
  return redactEntries(Object.entries(value), depth, seen);
}

function redactEntries(
  entries: readonly (readonly [unknown, unknown])[],
  depth: number,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [rawKey, rawValue] of entries) {
    const key = typeof rawKey === "string" ? rawKey : String(rawKey);
    safe[key] = isSensitiveKey(key) ? REDACTED : redactValue(rawValue, depth + 1, seen);
  }
  return safe;
}

/**
 * Retire les valeurs sensibles d'une structure arbitraire, à toute profondeur.
 * Tolère les cycles, les `Map`/`Set`, les `Date` et les `Error`.
 */
export function redact(context: LogContext): Record<string, unknown> {
  return redactEntries(Object.entries(context), 0, new WeakSet());
}

// ─── Émission ────────────────────────────────────────────────────────────────

/** Échappement ANSI, construit hors littéral pour ne pas glisser d'octet de contrôle dans les sources. */
const ESC = String.fromCharCode(27);
const RESET = `${ESC}[0m`;
const DIM = `${ESC}[2m`;
const COLOR_BY_LEVEL: Readonly<Record<LogLevel, string>> = {
  debug: `${ESC}[90m`,
  info: `${ESC}[36m`,
  warn: `${ESC}[33m`,
  error: `${ESC}[31m`,
};

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function resolveMinLevel(): LogLevel {
  const configured = process.env["LOG_LEVEL"];
  const known = LOG_LEVELS.find((level) => level === configured);
  if (known !== undefined) return known;
  return isProduction() ? "info" : "debug";
}

const minLevel = resolveMinLevel();

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function formatDev(
  level: LogLevel,
  timestamp: string,
  message: string,
  fields: Record<string, unknown>,
): string {
  const head = `${COLOR_BY_LEVEL[level]}${level.toUpperCase().padEnd(5)}${RESET}`;
  const time = `${DIM}${timestamp}${RESET}`;
  const rest = Object.keys(fields).length === 0 ? "" : ` ${JSON.stringify(fields)}`;
  return `${time} ${head} ${message}${rest}`;
}

function write(level: LogLevel, message: string, bindings: LogContext, context?: LogContext): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[minLevel]) return;

  const merged = context === undefined ? { ...bindings } : { ...bindings, ...context };
  const { requestId: rawRequestId, userId: rawUserId, ...rest } = redact(merged);

  const requestId = asString(rawRequestId);
  const userId = asString(rawUserId);
  const identity = {
    ...(requestId === undefined ? {} : { requestId }),
    ...(userId === undefined ? {} : { userId }),
  };

  // Horodatage d'infrastructure, toujours en UTC ISO — hors logique métier,
  // donc hors du périmètre de `nowInAppTz()`.
  const timestamp = new Date().toISOString();

  const line = isProduction()
    ? JSON.stringify({
        level,
        timestamp,
        message,
        ...identity,
        ...(Object.keys(rest).length === 0 ? {} : { context: rest }),
      })
    : formatDev(level, timestamp, message, { ...identity, ...rest });

  // Seul point d'écriture console de l'application.
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /** Dérive un logger portant un contexte permanent (`requestId`, `userId`, …). */
  child(bindings: LogContext): Logger;
}

function createLogger(bindings: LogContext): Logger {
  return {
    debug: (message, context) => {
      write("debug", message, bindings, context);
    },
    info: (message, context) => {
      write("info", message, bindings, context);
    },
    warn: (message, context) => {
      write("warn", message, bindings, context);
    },
    error: (message, context) => {
      write("error", message, bindings, context);
    },
    child: (extra) => createLogger({ ...bindings, ...extra }),
  };
}

export const logger: Logger = createLogger({});
