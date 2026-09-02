import { z } from "zod";

import { DOCUMENT_KINDS } from "@/config/constants";
import { optionalTextSchema, reasonSchema, uuidSchema } from "./primitives";

/**
 * Schémas de pièce jointe.
 *
 * ⚠️ CE MODULE NE VALIDE PAS LE CONTENU DU FICHIER, et c'est délibéré. Le type
 * MIME déclaré par le navigateur est une AFFIRMATION de l'appelant : un
 * exécutable renommé en `.pdf` l'annonce comme `application/pdf`. La vérité est
 * dans les premiers octets, contrôlée par `src/lib/files.ts` (`inspectHeader`),
 * côté client avant l'envoi ET côté serveur à la confirmation.
 *
 * Ce que ce module valide, c'est la FORME de la demande : des identifiants, un
 * nom, une taille annoncée dans les bornes. La signature binaire reste le seul
 * juge de ce qu'est réellement le fichier.
 */

/** 25 Mo, aligné sur la contrainte `size_bytes` de la table `documents`. */
export const MAX_DOCUMENT_BYTES = 26_214_400;

/**
 * Nom de fichier tel que le navigateur l'annonce.
 *
 * ⚠️ Refuse les séparateurs de chemin et les remontées `..`. Le nom est
 * renormalisé par le serveur avant tout usage (`buildNormalizedStem`), mais un
 * refus explicite ici donne un message compréhensible plutôt qu'un nom
 * silencieusement transformé.
 */
export const filenameSchema = z
  .string()
  .trim()
  .min(1, { error: "validation.filenameRequired" })
  .max(255, { error: "validation.filenameTooLong" })
  .refine((value) => !value.includes("/") && !value.includes("\\"), {
    error: "validation.filenamePath",
  })
  .refine((value) => !value.split(/[\\/]/).includes(".."), { error: "validation.filenamePath" });

export const uploadRequestSchema = z.object({
  occurrenceId: uuidSchema,
  checklistItemId: uuidSchema.optional(),
  filename: filenameSchema,
  mimeType: z
    .string()
    .trim()
    .min(1, { error: "validation.required" })
    .max(255, { error: "validation.tooLong" }),
  sizeBytes: z.coerce
    .number({ error: "validation.numberExpected" })
    .int({ error: "validation.integerExpected" })
    .positive({ error: "validation.fileEmpty" })
    .max(MAX_DOCUMENT_BYTES, { error: "validation.fileTooLarge" }),
  documentKind: z.enum(DOCUMENT_KINDS as [string, ...string[]]).optional(),
  supersedesId: uuidSchema.optional(),
});

export const uploadConfirmSchema = z.object({
  ticketId: uuidSchema,
  sha256: z.string().regex(/^[0-9a-f]{64}$/, { error: "validation.hashFormat" }),
  sizeBytes: z.coerce.number().int().positive().max(MAX_DOCUMENT_BYTES),
});

/**
 * Suppression logique — le motif est OBLIGATOIRE.
 *
 * ⚠️ Une pièce ne disparaît jamais : elle est marquée supprimée, avec qui, quand
 * et pourquoi. Sans motif, un contrôleur qui voit une pièce retirée d'un dossier
 * n'a aucun moyen de savoir si c'est une correction ou une dissimulation.
 */
export const documentRemovalSchema = z.object({
  documentId: uuidSchema,
  reason: reasonSchema,
});

export const documentSearchSchema = z.object({
  query: optionalTextSchema(200),
  occurrenceId: uuidSchema.optional(),
  documentKind: z.enum(DOCUMENT_KINDS as [string, ...string[]]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export type UploadRequestValues = z.infer<typeof uploadRequestSchema>;
export type UploadConfirmValues = z.infer<typeof uploadConfirmSchema>;
export type DocumentRemovalValues = z.infer<typeof documentRemovalSchema>;
export type DocumentSearchValues = z.infer<typeof documentSearchSchema>;
