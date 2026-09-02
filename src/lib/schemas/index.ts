import type { z } from "zod";

import { AppError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { fieldIssues, type FieldIssue } from "./messages";

/**
 * Surface publique des schémas partagés.
 *
 * ⚠️ TOUT PASSE PAR ICI, client comme serveur. Un formulaire importe le même
 * schéma que la Server Action qu'il alimente : la règle ne peut pas diverger
 * entre les deux, parce qu'il n'y en a qu'une.
 */

export * from "./primitives";
export * from "./messages";
export * from "./occurrence";
export * from "./document";

/**
 * Analyse une entrée non fiable, en PREMIÈRE INSTRUCTION d'une Server Action.
 *
 * ⚠️ `safeParse`, jamais `parse`. Une exception traversant une Server Action
 * produit une erreur de rendu opaque côté client — le fameux « an error
 * occurred », sans champ fautif, sans moyen de corriger. Ici l'échec est une
 * VALEUR : la couche au-dessus la transforme en messages par champ.
 *
 * ⚠️ Le détail transporté est la liste des champs et de leurs clés — jamais le
 * message brut de Zod, qui est en anglais et nomme des types internes.
 */
export function parseInput<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
): Result<z.output<TSchema>> {
  const parsed = schema.safeParse(input);

  if (parsed.success) return ok(parsed.data);

  const issues = fieldIssues(parsed.error);

  return err(
    AppError.validationFailed({
      // Sérialisable, et lisible par le composant : chaque entrée porte le
      // chemin du champ, la clé i18n et ses paramètres.
      fields: issues.map((issue) => ({ ...issue, params: { ...issue.params } })),
    }),
  );
}

/** Anomalies de champ portées par une erreur de validation, si elle en a. */
export function issuesOf(error: { details?: Record<string, unknown> | undefined }): FieldIssue[] {
  const raw = error.details?.["fields"];
  if (!Array.isArray(raw)) return [];

  return raw.filter(
    (entry): entry is FieldIssue =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as FieldIssue).path === "string" &&
      typeof (entry as FieldIssue).key === "string",
  );
}
