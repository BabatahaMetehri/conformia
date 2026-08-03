/**
 * Utilitaires transverses, sans dépendance et sans métier.
 *
 * Le helper `cn()` de shadcn/ui atterrira ici lorsque shadcn sera installé.
 */

/**
 * Garantit l'exhaustivité d'un `switch` à la compilation.
 * Indispensable pour la machine à états des occurrences : ajouter un statut
 * sans traiter le cas devient une erreur de type, pas un bug silencieux.
 */
export function assertNever(value: never, message = "Cas non traité"): never {
  throw new Error(`${message} : ${String(value)}`);
}

export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
