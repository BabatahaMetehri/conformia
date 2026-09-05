"use server";

/**
 * Server Actions de la fiche d'occurrence.
 *
 * Chaîne imposée : permission → validation Zod → service → revalidatePath →
 * Result sérialisable.
 *
 * ⚠️ Une Server Action est un point d'entrée HTTP à part entière. Masquer un
 * bouton ne protège rien : chaque action revérifie, et la base refuse en dernier
 * ressort. Les tests d'intégration appellent d'ailleurs les fonctions SQL
 * directement, sans passer par l'interface, précisément pour l'établir.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { OCCURRENCE_STATUSES } from "@/config/constants";
import { toClientError } from "@/lib/errors";
import { parseInput, reasonSchema, uuidSchema } from "@/lib/schemas";
import type { Result } from "@/lib/result";
import { removeDocument, requestUpload, confirmUpload } from "@/services/documents/upload";
import { requireAuthContext, requirePermission } from "@/services/auth/context";
import {
  createRectification,
  postComment,
  reassignOccurrence,
  reassignOccurrenceTriad,
  removeComment,
  transitionOccurrence,
} from "@/services/occurrences/detail";
import type { ActionOutcome } from "@/features/occurrences/actions/types";
import type {
  CommentOutcome,
  DepositOutcome,
  PlainOutcome,
  RectificationOutcome,
  TransitionActionOutcome,
  UploadTicketOutcome,
} from "@/features/occurrences/actions/detail-types";

/**
 * ⚠️ Le chemin revalidé est celui du SEGMENT, pas de l'URL rendue : le groupe de
 * route et le segment de locale en font partie. Un chemin sans eux ne
 * correspondrait à aucune entrée de cache et l'écran resterait figé.
 */
const DETAIL_PATH = "/[locale]/(app)/echeancier/[occurrenceId]";
const LIST_PATH = "/[locale]/(app)/echeancier";

function toOutcome<T>(result: Result<T>): ActionOutcome<T> {
  return result.ok
    ? { status: "success", data: result.value }
    : { status: "error", error: toClientError(result.error) };
}

/**
 * Refus de validation, AVEC le détail par champ.
 *
 * ⚠️ La version précédente rendait une erreur nue : l'utilisateur voyait
 * « données invalides » sans savoir lequel de ses huit champs posait problème.
 * `parseInput` transporte désormais le chemin du champ et sa clé de message, et
 * le composant les affiche sous le bon libellé.
 */
function rejected(error: ReturnType<typeof toClientError>): {
  readonly status: "error";
  readonly error: ReturnType<typeof toClientError>;
} {
  return { status: "error", error };
}

// ─── Transitions ─────────────────────────────────────────────────────────────

const LATE_REASON_CODES = [
  "MISSING_DOCUMENT",
  "VALIDATOR_UNAVAILABLE",
  "LATE_EXTERNAL_INFORMATION",
  "OVERSIGHT",
  "OTHER",
] as const;

const TransitionSchema = z.object({
  occurrenceId: uuidSchema,
  toStatus: z.enum(OCCURRENCE_STATUSES),
  expectedVersion: z.int().positive(),
  /*
   * ⚠️ `reasonSchema`, et non un simple `max(2000)`. Le motif d'un rejet ou
   * d'une réouverture est relu lors d'un contrôle : il exige dix caractères
   * SIGNIFICATIFS, refuse les espaces seuls et les saisies de remplissage. La
   * règle vit dans `lib/schemas`, partagée avec le formulaire qui la saisit.
   */
  reason: reasonSchema.optional(),
  referenceNumber: z.string().trim().max(120).optional(),
  lateReasonCode: z.enum(LATE_REASON_CODES).optional(),
  lateReason: reasonSchema.optional(),
});

/**
 * Change l'état d'un dossier.
 *
 * Aucune permission n'est nommée ici : le service la LIT dans
 * status_transition_rules à partir de la transition demandée. Une permission
 * écrite en dur à cet endroit deviendrait une seconde définition du cycle de vie.
 */
export async function transitionOccurrenceAction(input: unknown): Promise<TransitionActionOutcome> {
  /*
   * ⚠️ LA VALIDATION D'ABORD, la session ensuite. Deux raisons : une entrée
   * malformée ne mérite pas d'aller-retour vers la base, et l'ordre inverse
   * distinguerait par le temps de réponse un appelant authentifié d'un autre.
   */
  const parsed = parseInput(TransitionSchema, input);
  if (!parsed.ok) return rejected(toClientError(parsed.error));

  const context = await requireAuthContext();
  if (!context.ok) return { status: "error", error: toClientError(context.error) };

  const result = await transitionOccurrence(parsed.value);

  /*
   * ⚠️ TROIS ISSUES REVALIDENT, ET NON UNE SEULE. `APPLIED` était la seule
   * listée ; les deux autres laissaient l'écran sur des données fausses :
   *
   *   • `PARTIALLY_VALIDATED` — la première des deux validations EST écrite,
   *     même si l'état du dossier ne bouge pas. Sans revalidation, le compteur
   *     « 1 validation sur 2 » restait à zéro, et le validateur croyait son geste
   *     sans effet — puis recommençait.
   *   • `VERSION_CONFLICT` — quelqu'un d'autre a modifié le dossier entre
   *     l'affichage et le clic. C'est la définition même d'un écran périmé : le
   *     revalider est la seule manière de rendre la reprise possible, et elle
   *     appartient au serveur, pas à un `router.refresh()` côté client.
   *
   * Les autres issues sont des REFUS sans écriture : rien n'a changé, rien n'est
   * à revalider, et le faire ferait payer un aller-retour à chaque refus.
   */
  const REVALIDATING: readonly string[] = ["APPLIED", "PARTIALLY_VALIDATED", "VERSION_CONFLICT"];
  if (result.ok && REVALIDATING.includes(result.value.outcome)) {
    revalidatePath(DETAIL_PATH, "page");
    revalidatePath(LIST_PATH, "page");
  }

  return toOutcome(result);
}

// ─── Rectificative ───────────────────────────────────────────────────────────

const RectificationSchema = z.object({
  occurrenceId: uuidSchema,
  reason: z.string().trim().min(10).max(2000),
});

export async function createRectificationAction(input: unknown): Promise<RectificationOutcome> {
  const context = await requirePermission("occurrence.write");
  if (!context.ok) return { status: "error", error: toClientError(context.error) };

  const parsed = parseInput(RectificationSchema, input);
  if (!parsed.ok) return rejected(toClientError(parsed.error));

  const result = await createRectification(parsed.value.occurrenceId, parsed.value.reason);
  if (result.ok) {
    revalidatePath(DETAIL_PATH, "page");
    revalidatePath(LIST_PATH, "page");
  }

  return toOutcome(result);
}

// ─── Réaffectation ───────────────────────────────────────────────────────────

const ReassignSchema = z.object({ occurrenceId: uuidSchema, ownerId: uuidSchema });

export async function reassignSingleAction(
  input: unknown,
): Promise<ActionOutcome<{ readonly updated: number }>> {
  const context = await requirePermission("occurrence.assign");
  if (!context.ok) return { status: "error", error: toClientError(context.error) };

  const parsed = parseInput(ReassignSchema, input);
  if (!parsed.ok) return rejected(toClientError(parsed.error));

  const result = await reassignOccurrence(parsed.value.occurrenceId, parsed.value.ownerId);
  if (result.ok) revalidatePath(DETAIL_PATH, "page");

  return toOutcome(result);
}

/**
 * Réaffectation UNITAIRE des trois rôles, motif obligatoire.
 *
 * ⚠️ Le motif est exigé ICI par le schéma ET en base par la fonction SQL. Ce
 * n'est pas une duplication de règle mais une duplication de MESSAGE : le
 * schéma sert à rendre l'erreur lisible dans le formulaire, la base sert à ce
 * qu'aucun appel ne s'en dispense — une Server Action est un point d'entrée
 * HTTP, appelable depuis la console.
 */
const ReassignTriadSchema = z.object({
  occurrenceId: uuidSchema,
  ownerId: uuidSchema.nullable().default(null),
  deputyId: uuidSchema.nullable().default(null),
  validatorId: uuidSchema.nullable().default(null),
  reason: z
    .string()
    .trim()
    .min(3, { error: "validation.reasonTooShort" })
    .max(500, { error: "validation.reasonTooLong" }),
});

export async function reassignTriadAction(
  input: unknown,
): Promise<ActionOutcome<{ readonly updated: number }>> {
  const context = await requirePermission("occurrence.assign");
  if (!context.ok) return { status: "error", error: toClientError(context.error) };

  const parsed = parseInput(ReassignTriadSchema, input);
  if (!parsed.ok) return rejected(toClientError(parsed.error));

  const result = await reassignOccurrenceTriad(parsed.value);
  // ⚠️ `revalidatePath` suffit : pas de `router.refresh()` après un `await` côté
  // client, motif que le prochain lot doit corriger ailleurs et qu'on
  // n'introduit pas ici.
  if (result.ok) revalidatePath(DETAIL_PATH, "page");

  return toOutcome(result);
}

// ─── Discussion ──────────────────────────────────────────────────────────────

const CommentSchema = z.object({
  occurrenceId: uuidSchema,
  body: z.string().trim().min(1).max(5000),
  mentionedUserIds: z.array(uuidSchema).max(20).default([]),
});

export async function postCommentAction(input: unknown): Promise<CommentOutcome> {
  const context = await requireAuthContext();
  if (!context.ok) return { status: "error", error: toClientError(context.error) };

  const parsed = parseInput(CommentSchema, input);
  if (!parsed.ok) return rejected(toClientError(parsed.error));

  const result = await postComment(
    parsed.value.occurrenceId,
    parsed.value.body,
    parsed.value.mentionedUserIds,
  );
  if (result.ok) revalidatePath(DETAIL_PATH, "page");

  return toOutcome(result);
}

export async function removeCommentAction(commentId: unknown): Promise<PlainOutcome> {
  const context = await requireAuthContext();
  if (!context.ok) return { status: "error", error: toClientError(context.error) };

  const parsed = parseInput(uuidSchema, commentId);
  if (!parsed.ok) return rejected(toClientError(parsed.error));

  const result = await removeComment(parsed.value);
  if (result.ok) revalidatePath(DETAIL_PATH, "page");

  return result.ok
    ? { status: "success", data: null }
    : { status: "error", error: toClientError(result.error) };
}

// ─── Pièces : dépôt direct ───────────────────────────────────────────────────

/**
 * Dépôt d'une pièce — DEUX TEMPS, et aucun octet ici.
 *
 * ⚠️ Ces actions ne reçoivent PLUS de `FormData` portant un fichier. Depuis 0009,
 * le binaire va du navigateur au stockage sans traverser ce processus : la
 * première action rend une autorisation d'écrire bornée à un chemin, la seconde
 * constate ce qui a été écrit et en vérifie la signature.
 *
 * Elles vivent ici, et non dans `features/documents`, parce que la barrière
 * inter-features interdit à l'onglet « Dossier » d'importer l'autre feature. Le
 * MÉTIER, lui, n'est pas dupliqué : les deux appellent le même service.
 */
const RequestUploadSchema = z.object({
  occurrenceId: uuidSchema,
  checklistItemId: uuidSchema.nullable(),
  filename: z.string().trim().min(1).max(400),
  declaredMimeType: z.string().trim().min(1).max(200),
  sizeBytes: z.number().int().positive(),
});

export async function requestUploadAction(input: unknown): Promise<UploadTicketOutcome> {
  const context = await requirePermission("document.upload");
  if (!context.ok) return { status: "error", error: toClientError(context.error) };

  const parsed = parseInput(RequestUploadSchema, input);
  if (!parsed.ok) return rejected(toClientError(parsed.error));

  return toOutcome(await requestUpload(parsed.value));
}

const ConfirmUploadSchema = z.object({
  ticketId: uuidSchema,
  sha256: z.string().regex(/^[0-9a-fA-F]{64}$/),
});

export async function confirmUploadAction(input: unknown): Promise<DepositOutcome> {
  const context = await requirePermission("document.upload");
  if (!context.ok) return { status: "error", error: toClientError(context.error) };

  const parsed = parseInput(ConfirmUploadSchema, input);
  if (!parsed.ok) return rejected(toClientError(parsed.error));

  const result = await confirmUpload(parsed.value);
  if (result.ok) revalidatePath(DETAIL_PATH, "page");
  return toOutcome(result);
}

const RemoveDocumentSchema = z.object({
  documentId: uuidSchema,
  reason: z.string().trim().min(10).max(2000),
});

export async function removeDocumentAction(input: unknown): Promise<PlainOutcome> {
  const context = await requirePermission("document.delete");
  if (!context.ok) return { status: "error", error: toClientError(context.error) };

  const parsed = parseInput(RemoveDocumentSchema, input);
  if (!parsed.ok) return rejected(toClientError(parsed.error));

  const result = await removeDocument(parsed.value.documentId, parsed.value.reason);
  if (result.ok) revalidatePath(DETAIL_PATH, "page");

  return result.ok
    ? { status: "success", data: null }
    : { status: "error", error: toClientError(result.error) };
}
