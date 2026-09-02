import { z } from "zod";

import { OCCURRENCE_STATUSES } from "@/config/constants";
import {
  isoDateSchema,
  optionalTextSchema,
  paginationSchema,
  reasonSchema,
  uuidSchema,
} from "./primitives";

/**
 * Schémas d'occurrence — composition `base → create → update → filter`.
 *
 * ⚠️ LES RÈGLES DE COHÉRENCE DE DATES VIVENT ICI, une seule fois. Elles étaient
 * jusque-là éparpillées : un bout dans la contrainte SQL, un bout dans le
 * formulaire, rien dans les Server Actions. La base reste l'autorité — elle seule
 * ne peut pas être contournée — mais l'utilisateur mérite de l'apprendre AVANT
 * d'envoyer, avec un message qui nomme la date fautive.
 */

// ─── Cohérence des dates ─────────────────────────────────────────────────────

export interface PeriodDates {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly legalDueDate: string;
  readonly internalDueDate: string;
}

/**
 * Vérifie l'ordre des quatre dates d'une occurrence.
 *
 * ⚠️ Les comparaisons se font sur les chaînes `AAAA-MM-JJ`, pas sur des `Date`.
 * L'ordre lexicographique de ce format est l'ordre chronologique, et il évite
 * toute conversion de fuseau — laquelle décalerait une borne d'un jour selon
 * l'endroit d'où l'on valide. Une échéance qui change de jour parce que le
 * navigateur est à Paris est exactement le défaut qu'on ne veut pas.
 */
export function checkPeriodCoherence(
  dates: PeriodDates,
  addIssue: (path: keyof PeriodDates, key: string) => void,
): void {
  if (dates.periodEnd < dates.periodStart) {
    addIssue("periodEnd", "validation.periodEndBeforeStart");
  }

  /*
   * ⚠️ L'échéance LÉGALE ne peut pas précéder la fin de la période déclarée. Une
   * déclaration porte sur une période close : exiger son dépôt avant que la
   * période soit terminée n'a pas de sens, et produirait un dossier en retard
   * dès sa création.
   */
  if (dates.legalDueDate < dates.periodEnd) {
    addIssue("legalDueDate", "validation.dueBeforePeriodEnd");
  }

  /*
   * L'échéance INTERNE précède la légale — c'est sa raison d'être : se donner de
   * la marge. Une interne postérieure à la légale inverserait l'alerte, qui
   * partirait après le retard.
   */
  if (dates.internalDueDate > dates.legalDueDate) {
    addIssue("internalDueDate", "validation.internalAfterLegal");
  }

  if (dates.internalDueDate < dates.periodStart) {
    addIssue("internalDueDate", "validation.internalBeforePeriodStart");
  }
}

// ─── Base ────────────────────────────────────────────────────────────────────

export const occurrenceBaseSchema = z.object({
  obligationTypeId: uuidSchema,
  periodKey: z
    .string()
    .trim()
    .min(4, { error: "validation.tooShort" })
    .max(32, { error: "validation.tooLong" }),
  periodStart: isoDateSchema,
  periodEnd: isoDateSchema,
  legalDueDate: isoDateSchema,
  internalDueDate: isoDateSchema,
  ownerId: uuidSchema.optional(),
  validatorId: uuidSchema.optional(),
});

const withCoherence = <T extends z.ZodType>(schema: T) =>
  schema.superRefine((value: unknown, ctx: z.RefinementCtx) => {
    const dates = value as Partial<PeriodDates>;
    if (
      dates.periodStart === undefined ||
      dates.periodEnd === undefined ||
      dates.legalDueDate === undefined ||
      dates.internalDueDate === undefined
    ) {
      // Champ absent : l'anomalie de type a déjà été signalée. Ajouter une
      // seconde erreur sur le même champ le rendrait illisible.
      return;
    }

    checkPeriodCoherence(dates as PeriodDates, (path, key) => {
      ctx.addIssue({ code: "custom", path: [path], message: key });
    });
  });

export const createOccurrenceSchema = withCoherence(occurrenceBaseSchema);

/** Mise à jour : tout est facultatif, sauf la cohérence quand tout est fourni. */
export const updateOccurrenceSchema = withCoherence(
  occurrenceBaseSchema.partial().extend({ id: uuidSchema }),
);

// ─── Filtres de liste ────────────────────────────────────────────────────────

export const occurrenceFilterSchema = paginationSchema.extend({
  status: z.array(z.enum(OCCURRENCE_STATUSES as [string, ...string[]])).optional(),
  domainId: uuidSchema.optional(),
  authorityId: uuidSchema.optional(),
  ownerId: uuidSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  search: optionalTextSchema(200),
  mine: z.coerce.boolean().optional(),
});

// ─── Transition d'état, avec verrouillage optimiste ──────────────────────────

/**
 * ⚠️ `expectedVersion` N'EST PAS FACULTATIF, et c'est tout le sujet.
 *
 * Deux personnes ouvrent le même dossier, l'une valide, l'autre rejette : sans
 * version attendue, la seconde écriture écrase la première EN SILENCE, et
 * l'historique montre un rejet sur un dossier validé — incompréhensible six mois
 * plus tard. La base compare la version et refuse ; l'interface affiche un
 * message de conflit et propose de recharger.
 */
export const transitionSchema = z.object({
  occurrenceId: uuidSchema,
  toStatus: z.enum(OCCURRENCE_STATUSES as [string, ...string[]]),
  expectedVersion: z.coerce
    .number({ error: "validation.numberExpected" })
    .int({ error: "validation.integerExpected" })
    .min(1, { error: "validation.numberTooSmall" }),
  reason: reasonSchema.optional(),
  lateReasonCode: z.string().max(64).optional(),
  referenceNumber: optionalTextSchema(120),
});

/** Réaffectation : elle aussi porte une version attendue. */
export const reassignSchema = z.object({
  occurrenceId: uuidSchema,
  ownerId: uuidSchema,
  expectedVersion: z.coerce.number().int().min(1).optional(),
});

export const rectificationSchema = z.object({
  occurrenceId: uuidSchema,
  reason: reasonSchema,
});

export const commentSchema = z.object({
  occurrenceId: uuidSchema,
  body: z
    .string()
    .trim()
    .min(1, { error: "validation.tooShort" })
    .max(4000, { error: "validation.tooLong" }),
  mentionedUserIds: z.array(uuidSchema).max(20).optional(),
});

// ─── Types inférés ───────────────────────────────────────────────────────────

/**
 * ⚠️ INFÉRÉS, jamais écrits en parallèle. Un type déclaré à la main à côté d'un
 * schéma diverge au premier ajout de champ, et le compilateur ne dit rien —
 * puisque les deux sont valides séparément.
 */
export type OccurrenceBase = z.infer<typeof occurrenceBaseSchema>;
export type CreateOccurrenceInput = z.input<typeof createOccurrenceSchema>;
export type CreateOccurrenceValues = z.infer<typeof createOccurrenceSchema>;
export type UpdateOccurrenceValues = z.infer<typeof updateOccurrenceSchema>;
export type OccurrenceFilterValues = z.infer<typeof occurrenceFilterSchema>;
export type TransitionValues = z.infer<typeof transitionSchema>;
export type ReassignValues = z.infer<typeof reassignSchema>;
export type RectificationValues = z.infer<typeof rectificationSchema>;
export type CommentValues = z.infer<typeof commentSchema>;
