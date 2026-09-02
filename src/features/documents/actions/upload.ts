"use server";

/**
 * Server Actions du dépôt direct.
 *
 * ⚠️ AUCUNE de ces actions ne reçoit de fichier. La première rend une
 * autorisation d'écrire, la seconde constate ce qui a été écrit. Le binaire va
 * du navigateur au stockage sans passer par ici — c'est tout l'objet de la
 * refonte de 0009, et un `FormData` portant un `File` dans ce fichier serait le
 * retour du modèle qu'on vient d'abandonner.
 *
 * Chaque action revérifie la permission. Les contrôles de l'interface — type,
 * taille, extension — sont du CONFORT : ils évitent un aller-retour inutile, ils
 * ne protègent rien. Tout ce qui compte est refait côté serveur, et l'essentiel
 * l'est même côté base.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type {
  ConfirmActionOutcome,
  PlainDocumentOutcome,
  TicketActionOutcome,
} from "@/features/documents/actions/types";
import { toClientError } from "@/lib/errors";
import { requirePermission } from "@/services/auth/context";
import { confirmUpload, removeDocument, requestUpload } from "@/services/documents/upload";
import { acknowledgeIntegrityAlert } from "@/services/documents/integrity";
import { uuidSchema } from "@/lib/schemas";

const OCCURRENCE_DETAIL_PATH = "/[locale]/(app)/echeancier/[occurrenceId]";
const DOCUMENTS_PATH = "/[locale]/(app)/documents";

function invalid(): { readonly status: "error"; readonly error: ReturnType<typeof toClientError> } {
  return {
    status: "error",
    error: { code: "VALIDATION_FAILED", message: "errors.validationFailed", httpStatus: 422 },
  };
}

const RequestSchema = z.object({
  occurrenceId: uuidSchema,
  checklistItemId: uuidSchema.nullable(),
  filename: z.string().trim().min(1).max(400),
  declaredMimeType: z.string().trim().min(1).max(200),
  sizeBytes: z.number().int().positive(),
});

export async function requestUploadAction(input: unknown): Promise<TicketActionOutcome> {
  const context = await requirePermission("document.upload");
  if (!context.ok) return { status: "error", error: toClientError(context.error) };

  const parsed = RequestSchema.safeParse(input);
  if (!parsed.success) return invalid();

  const result = await requestUpload(parsed.data);
  if (!result.ok) return { status: "error", error: toClientError(result.error) };
  return { status: "success", data: result.value };
}

const ConfirmSchema = z.object({
  ticketId: uuidSchema,
  // 64 hexadécimaux, sans exception : la base applique la même contrainte, et un
  // format libre y produirait une violation de contrainte plutôt qu'un refus lisible.
  sha256: z.string().regex(/^[0-9a-fA-F]{64}$/),
});

export async function confirmUploadAction(input: unknown): Promise<ConfirmActionOutcome> {
  const context = await requirePermission("document.upload");
  if (!context.ok) return { status: "error", error: toClientError(context.error) };

  const parsed = ConfirmSchema.safeParse(input);
  if (!parsed.success) return invalid();

  const result = await confirmUpload(parsed.data);
  if (!result.ok) return { status: "error", error: toClientError(result.error) };

  revalidatePath(OCCURRENCE_DETAIL_PATH, "page");
  revalidatePath(DOCUMENTS_PATH, "page");
  return { status: "success", data: result.value };
}

const RemoveSchema = z.object({
  documentId: uuidSchema,
  reason: z.string().trim().min(10).max(2000),
});

export async function removeDocumentAction(input: unknown): Promise<PlainDocumentOutcome> {
  const context = await requirePermission("document.delete");
  if (!context.ok) return { status: "error", error: toClientError(context.error) };

  const parsed = RemoveSchema.safeParse(input);
  if (!parsed.success) return invalid();

  const result = await removeDocument(parsed.data.documentId, parsed.data.reason);
  if (!result.ok) return { status: "error", error: toClientError(result.error) };

  revalidatePath(OCCURRENCE_DETAIL_PATH, "page");
  revalidatePath(DOCUMENTS_PATH, "page");
  return { status: "success", data: result.value };
}

const AcknowledgeSchema = z.object({
  checkId: z.number().int().positive(),
  note: z.string().trim().min(10).max(2000),
});

export async function acknowledgeIntegrityAlertAction(
  input: unknown,
): Promise<PlainDocumentOutcome> {
  const parsed = AcknowledgeSchema.safeParse(input);
  if (!parsed.success) return invalid();

  const result = await acknowledgeIntegrityAlert(parsed.data.checkId, parsed.data.note);
  if (!result.ok) return { status: "error", error: toClientError(result.error) };

  revalidatePath(DOCUMENTS_PATH, "page");
  return { status: "success", data: result.value };
}
