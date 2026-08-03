/**
 * Journalisation structurée (JSON une ligne), sans dépendance.
 *
 * Ce module lit `process.env` directement plutôt que `@/config/env` : la
 * validation d'environnement doit pouvoir se plaindre sans dépendre du logger.
 *
 * Les documents traités sont sensibles : toute clé de contexte ressemblant à un
 * secret est masquée avant écriture. Ne jamais journaliser un contenu de document.
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

const SENSITIVE_KEY_PATTERN =
  /secret|token|password|passe|authorization|cookie|api[_-]?key|service[_-]?role|anon[_-]?key/i;
const REDACTED = "[redacted]";
const MAX_REDACTION_DEPTH = 4;

function redactValue(value: unknown, depth: number): unknown {
  if (depth >= MAX_REDACTION_DEPTH) return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1));
  }
  if (typeof value !== "object" || value === null) return value;
  return redactEntries(value, depth);
}

function redactEntries(source: object, depth: number): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(source)) {
    safe[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactValue(nested, depth + 1);
  }
  return safe;
}

function resolveMinLevel(): LogLevel {
  const configured = process.env["LOG_LEVEL"];
  const known = LOG_LEVELS.find((level) => level === configured);
  if (known !== undefined) return known;
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

const minLevel = resolveMinLevel();

function write(level: LogLevel, message: string, bindings: LogContext, context?: LogContext): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[minLevel]) return;

  const merged: LogContext = context === undefined ? bindings : { ...bindings, ...context };
  const record = {
    level,
    time: new Date().toISOString(),
    message,
    ...redactEntries(merged, 0),
  };
  const line = JSON.stringify(record);

  // Seul point d'écriture console de l'application : la sortie est collectée
  // par la plateforme d'hébergement.
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /** Dérive un logger portant un contexte permanent (requestId, userId, …). */
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
