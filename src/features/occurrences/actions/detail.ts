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
import type { Result } from "@/lib/result";
import { removeDocument, requestUpload, confirmUpload } from "@/services/documents/upload";
import { requireAuthContext, requirePermission } from "@/services/auth/context";
import {
  createRectification,
  postComment,
  reassignOccurrence,
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

function invalid(): { readonly status: "error"; readonly error: ReturnType<typeof toClientError> } {
  return {
    status: "error",
    error: { code: "VALIDATION_FAILED", message: "errors.validationFailed", httpStatus: 422 },
  };
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
  occurrenceId: z.uuid(),
  toStatus: z.enum(OCCURRENCE_STATUSES),
  expectedVersion: z.int().positive(),
  reason: z.string().trim().max(2000).optional(),
  referenceNumber: z.string().trim().max(120).optional(),
  lateReasonCode: z.enum(LATE_REASON_CODES).optional(),
  lateReason: z.string().trim().max(2000).optional(),
});

/**
 * Change l'état d'un dossier.
 *
 * Aucune permission n'est nommée ici : le service la LIT dans
 * status_transition_rules à partir de la transition demandée. Une permission
 * écrite en dur à cet endroit deviendrait une seconde définition du cycle de vie.
 */
export async function transitionOccurrenceAction(input: unknown): Promise<TransitionActionOutcome> {
  const context = await requireAuthContext();
  if (!context.ok) return { status: "error", error: toClientError(context.error) };

  const parsed = TransitionSchema.safeParse(input);
  if (!parsed.success) return invalid();

  const result = await transitionOccurrence(parsed.data);
  if (result.ok && result.value.outcome === "APPLIED") {
    revalidatePath(DETAIL_PATH, "page");
    revalidatePath(LIST_PATH, "page");
  }

  return toOutcome(result);
}

// ─── Rectificative ───────────────────────────────────────────────────────────

const RectificationSchema = z.object({
  occurrenceId: z.uuid(),
  reason: z.string().trim().min(10).max(2000),
});

export async function createRectificationAction(input: unknown): Promise<RectificationOutcome> {
  const context = await requirePermission("occurrence.write");
  if (!context.ok) return { status: "error", error: toClientError(context.error) };

  const parsed = RectificationSchema.safeParse(input);
  if (!parsed.success) return invalid();

  const result = await createRectification(parsed.data.occurrenceId, parsed.data.reason);
  if (result.ok) {
    revalidatePath(DETAIL_PATH, "page");
    revalidatePath(LIST_PATH, "page");
  }

  return toOutcome(result);
}

// ─── Réaffectation ───────────────────────────────────────────────────────────

const ReassignSchema = z.object({ occurrenceId: z.uuid(), ownerId: z.uuid() });

export async function reassignSingleAction(
  input: unknown,
): Promise<ActionOutcome<{ readonly updated: number }>> {
  const context = await requirePermission("occurrence.assign");
  if (!context.ok) return { status: "error", error: toClientError(context.error) };

  const parsed = ReassignSchema.safeParse(input);
  if (!parsed.success) return invalid();

  const result = await reassignOccurrence(parsed.data.occurrenceId, parsed.data.ownerId);
  if (result.ok) revalidatePath(DETAIL_PATH, "page");

  return toOutcome(result);
}

// ─── Discussion ──────────────────────────────────────────────────────────────

const CommentSchema = z.object({
  occurrenceId: z.uuid(),
  body: z.string().trim().min(1).max(5000),
  mentionedUserIds: z.array(z.uuid()).max(20).default([]),
});

export async function postCommentAction(input: unknown): Promise<CommentOutcome> {
  const context = await requireAuthContext();
  if (!context.ok) return { status: "error", error: toClientError(context.error) };

  const parsed = CommentSchema.safeParse(input);
  if (!parsed.success) return invalid();

  const result = await postComment(
    parsed.data.occurrenceId,
    parsed.data.body,
    parsed.data.mentionedUserIds,
  );
  if (result.ok) revalidatePath(DETAIL_PATH, "page");

  return toOutcome(result);
}

export async function removeCommentAction(commentId: unknown): Promise<PlainOutcome> {
  const context = await requireAuthContext();
  if (!context.ok) return { status: "error", error: toClientError(context.error) };

  const parsed = z.uuid().safeParse(commentId);
  if (!parsed.success) return invalid();

  const result = await removeComment(parsed.data);
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
  occurrenceId: z.uuid(),
  checklistItemId: z.uuid().nullable(),
  filename: z.string().trim().min(1).max(400),
  declaredMimeType: z.string().trim().min(1).max(200),
  sizeBytes: z.number().int().positive(),
});

export async function requestUploadAction(input: unknown): Promise<UploadTicketOutcome> {
  const context = await requirePermission("document.upload");
  if (!context.ok) return { status: "error", error: toClientError(context.error) };

  const parsed = RequestUploadSchema.safeParse(input);
  if (!parsed.success) return invalid();

  return toOutcome(await requestUpload(parsed.data));
}

const ConfirmUploadSchema = z.object({
  ticketId: z.uuid(),
  sha256: z.string().regex(/^[0-9a-fA-F]{64}$/),
});

export async function confirmUploadAction(input: unknown): Promise<DepositOutcome> {
  const context = await requirePermission("document.upload");
  if (!context.ok) return { status: "error", error: toClientError(context.error) };

  const parsed = ConfirmUploadSchema.safeParse(input);
  if (!parsed.success) return invalid();

  const result = await confirmUpload(parsed.data);
  if (result.ok) revalidatePath(DETAIL_PATH, "page");
  return toOutcome(result);
}

const RemoveDocumentSchema = z.object({
  documentId: z.uuid(),
  reason: z.string().trim().min(10).max(2000),
});

export async function removeDocumentAction(input: unknown): Promise<PlainOutcome> {
  const context = await requirePermission("document.delete");
  if (!context.ok) return { status: "error", error: toClientError(context.error) };

  const parsed = RemoveDocumentSchema.safeParse(input);
  if (!parsed.success) return invalid();

  const result = await removeDocument(parsed.data.documentId, parsed.data.reason);
  if (result.ok) revalidatePath(DETAIL_PATH, "page");

  return result.ok
    ? { status: "success", data: null }
    : { status: "error", error: toClientError(result.error) };
}
