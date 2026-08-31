/**
 * Utilitaires transverses, sans métier.
 */

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Fusionne des classes Tailwind en laissant la dernière gagner.
 * `clsx` gère les conditions, `twMerge` résout les conflits : sans lui,
 * `cn("p-2", "p-4")` produirait deux classes concurrentes dont l'ordre CSS,
 * et non l'ordre d'écriture, déciderait.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

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
