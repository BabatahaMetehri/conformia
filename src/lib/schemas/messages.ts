import type { z } from "zod";

/**
 * Traduction d'une anomalie de validation en message ACTIONNABLE.
 *
 * ⚠️ « Valeur invalide » est un défaut, pas un message. Un message de validation
 * doit dire CE QUI NE VA PAS et COMMENT LE CORRIGER — sans quoi l'utilisateur
 * essaie au hasard, puis abandonne, puis appelle. Les libellés vivent dans
 * `messages/fr.json`, section `validation` ; ce module choisit la clé et fournit
 * ses paramètres.
 *
 * ⚠️ Ce module ne dépend PAS de next-intl : il reçoit une fonction de
 * traduction. C'est ce qui lui permet de servir à la fois un formulaire (via
 * `useTranslations`) et une Server Action (via `appTranslator`), avec le même
 * verdict des deux côtés.
 */

/** Fonction de traduction, réduite à ce dont ce module a besoin. */
export type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Clés produites par nos primitives : elles commencent toutes par `validation.`. */
const OWN_KEY = /^validation\.[A-Za-z]+$/;

/**
 * Repli par code d'anomalie, pour tout ce que nos primitives ne couvrent pas —
 * un `z.enum` refusé, un objet mal formé, un champ absent.
 */
const BY_CODE: Readonly<Record<string, string>> = {
  invalid_type: "validation.required",
  invalid_value: "validation.invalidChoice",
  invalid_format: "validation.invalidFormat",
  too_small: "validation.tooShort",
  too_big: "validation.tooLong",
  not_multiple_of: "validation.invalidFormat",
  unrecognized_keys: "validation.unexpectedField",
  invalid_union: "validation.invalidFormat",
  custom: "validation.invalidValue",
};

interface IssueLike {
  readonly code: string;
  readonly message: string;
  readonly path: readonly PropertyKey[];
  readonly minimum?: number | bigint | undefined;
  readonly maximum?: number | bigint | undefined;
  readonly expected?: string | undefined;
}

function numberOf(value: number | bigint | undefined): number | undefined {
  if (value === undefined) return undefined;
  return typeof value === "bigint" ? Number(value) : value;
}

/**
 * Message lisible pour une anomalie.
 *
 * ⚠️ Une clé inconnue retombe sur `validation.invalidValue` PLUTÔT QUE de
 * renvoyer le message brut de Zod. Celui-ci est en anglais et technique
 * (« String must contain at least 2 character(s) ») : l'afficher ferait fuiter
 * l'outillage dans l'interface, et ne dirait rien d'utile à l'utilisateur.
 */
export function translateIssue(issue: IssueLike, t: Translate): string {
  const parameters: Record<string, string | number> = {};

  const minimum = numberOf(issue.minimum);
  const maximum = numberOf(issue.maximum);
  if (minimum !== undefined) parameters["min"] = minimum;
  if (maximum !== undefined) parameters["max"] = maximum;

  // Nos primitives posent la clé dans le message : elle fait autorité.
  if (OWN_KEY.test(issue.message)) return t(issue.message, parameters);

  const fallback = BY_CODE[issue.code] ?? "validation.invalidValue";
  return t(fallback, parameters);
}

/** Chemin d'un champ, en notation pointée : `requiredDocuments.0.label`. */
export function issuePath(path: readonly PropertyKey[]): string {
  return path.map((segment) => String(segment)).join(".");
}

/**
 * Anomalies regroupées par champ, prêtes pour un formulaire.
 *
 * ⚠️ La PREMIÈRE anomalie de chaque champ l'emporte. Empiler trois messages sous
 * un même champ les rend tous illisibles ; les schémas sont d'ailleurs écrits du
 * plus structurant au plus fin, de sorte que la première est la plus utile.
 */
export function fieldErrors(error: z.ZodError, t: Translate): Readonly<Record<string, string>> {
  const messages: Record<string, string> = {};

  for (const issue of error.issues) {
    const key = issuePath(issue.path);
    messages[key] ??= translateIssue(issue, t);
  }

  return messages;
}

/**
 * Anomalies au FORMAT DE TRANSPORT : clé + paramètres, sans traduction.
 *
 * ⚠️ Une Server Action ne traduit pas : elle rend des clés, et le composant les
 * affiche dans la langue de son lecteur. Traduire côté serveur figerait la
 * langue au moment de la validation, alors que la locale est une propriété de
 * l'affichage.
 */
export interface FieldIssue {
  readonly path: string;
  readonly key: string;
  readonly params: Readonly<Record<string, string | number>>;
}

export function fieldIssues(error: z.ZodError): readonly FieldIssue[] {
  const seen = new Set<string>();
  const issues: FieldIssue[] = [];

  for (const issue of error.issues) {
    const path = issuePath(issue.path);
    if (seen.has(path)) continue;
    seen.add(path);

    /*
     * `minimum` et `maximum` n'existent que sur certaines variantes d'anomalie —
     * l'union de Zod ne les déclare pas à la racine. On passe donc par la même
     * forme réduite que `translateIssue`, plutôt que d'élargir le type.
     */
    const bounded = issue as IssueLike;
    const parameters: Record<string, string | number> = {};
    const minimum = numberOf(bounded.minimum);
    const maximum = numberOf(bounded.maximum);
    if (minimum !== undefined) parameters["min"] = minimum;
    if (maximum !== undefined) parameters["max"] = maximum;

    issues.push({
      path,
      key: OWN_KEY.test(issue.message)
        ? issue.message
        : (BY_CODE[issue.code] ?? "validation.invalidValue"),
      params: parameters,
    });
  }

  return issues;
}
