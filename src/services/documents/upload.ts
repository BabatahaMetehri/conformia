import "server-only";

/**
 * Dépôt d'une pièce, en deux temps.
 *
 * ⚠️ LE FICHIER NE TRANSITE JAMAIS PAR LE SERVEUR NEXT.JS.
 *
 *   1. `requestUpload` — le serveur vérifie le droit, le verrou, le type, la
 *      taille et le quota, fige un chemin et une version dans un BILLET, puis
 *      rend une autorisation d'écrire valable pour ce seul chemin.
 *   2. le navigateur envoie les octets DIRECTEMENT au stockage.
 *   3. `confirmUpload` — le serveur relit l'EN-TÊTE de ce qui a réellement été
 *      écrit, en vérifie la signature binaire, puis inscrit la ligne `documents`.
 *
 * L'ordre est celui-là et pas l'inverse : entre 2 et 3, il existe un objet que
 * personne ne peut lire — la politique de lecture de storage.objects exige une
 * ligne `documents` portant ce chemin. C'est l'état sûr. L'ordre inverse
 * produirait une ligne visible pointant vers un fichier absent : une pièce
 * fantôme dans un dossier de conformité, bien pire qu'un octet perdu.
 *
 * Ce que le client fournit et qui n'est PAS cru sur parole : le type MIME
 * (recoupé avec la signature), la taille (recoupée avec l'objet stocké), le nom
 * (assaini, et il n'entre pas dans le chemin). Ce qu'il fournit et qui ne peut
 * pas être recoupé : l'empreinte SHA-256. Elle est donc DÉCLARÉE, et
 * `documents.integrity_status` reste à PENDING jusqu'au contrôle mensuel qui la
 * confronte aux octets stockés.
 */

import { STORAGE_BUCKET_DOCUMENTS } from "@/config/constants";
import {
  fetchObjectHead,
  getNamingContext,
  getUploadTicket,
  type UploadTicket,
} from "@/data/queries/documents";
import {
  confirmUpload as confirmUploadRow,
  createSignedUploadUrl,
  createUploadTicket,
  rejectUploadTicket,
  softDeleteDocument,
  type ConfirmOutcomeCode,
  type TicketOutcomeCode,
} from "@/data/mutations/documents";
import { AppError } from "@/lib/errors";
import {
  buildNormalizedStem,
  canonicalMimeOfFamily,
  extensionOf,
  inspectHeader,
  slugify,
  type FileRejection,
} from "@/lib/files";
import { err, ok, type Result } from "@/lib/result";
import { requirePermission } from "@/services/auth/context";
import { toDocumentId } from "@/types/domain";

export interface UploadRequest {
  readonly occurrenceId: string;
  /** Pièce attendue à laquelle rattacher le dépôt, ou `null` pour une pièce libre. */
  readonly checklistItemId: string | null;
  readonly filename: string;
  readonly declaredMimeType: string;
  readonly sizeBytes: number;
}

export interface UploadTicketView {
  readonly ticketId: string;
  readonly uploadUrl: string;
  readonly token: string;
  readonly storagePath: string;
  readonly bucket: string;
  readonly normalizedFilename: string;
  readonly version: number;
  readonly expiresInSeconds: number;
}

/**
 * Refus exprimés au client.
 *
 * Réunit les trois vocabulaires du parcours : ce que refuse la base à l'émission
 * du billet, ce qu'elle refuse à la confirmation, et ce que refuse la relecture
 * de l'en-tête. Ils sont volontairement dans une seule union — pour l'utilisateur,
 * « votre fichier a été refusé » est un seul événement, quelle que soit l'étape.
 */
export type UploadRefusal =
  TicketOutcomeCode | ConfirmOutcomeCode | FileRejection | "UPLOAD_NOT_FOUND";

export async function requestUpload(request: UploadRequest): Promise<Result<UploadTicketView>> {
  const context = await requirePermission("document.upload");
  if (!context.ok) return context;

  // Le nom de la pièce et sa nature sont lus EN BASE, pas reçus du formulaire.
  const naming = await getNamingContext(request.occurrenceId, request.checklistItemId);
  if (!naming.ok) return naming;

  const extension = extensionOf(request.filename);
  const stem = request.filename.replace(/\.[^.]*$/, "");

  const ticket = await createUploadTicket({
    occurrenceId: request.occurrenceId,
    checklistItemId: request.checklistItemId,
    originalFilename: request.filename,
    mimeType: request.declaredMimeType,
    sizeBytes: request.sizeBytes,
    documentKind: naming.value.documentKind,
    slug: slugify(stem) || "piece",
    extension: extension.length > 0 ? extension : null,
    nameStem: buildNormalizedStem({
      obligationCode: naming.value.obligationCode,
      periodKey: naming.value.periodKey,
      documentKind: naming.value.documentKind,
      // Pièce libre : le nom d'origine tient lieu de libellé, faute de ligne
      // de liste de contrôle à laquelle l'emprunter.
      pieceLabel: naming.value.pieceLabel ?? stem,
    }),
  });
  if (!ticket.ok) return ticket;

  if (ticket.value.outcome !== "ISSUED") {
    return err(
      AppError.validationFailed({
        reason: ticket.value.outcome,
        ...(ticket.value.quotaBytes === null
          ? {}
          : { usedBytes: ticket.value.usedBytes, quotaBytes: ticket.value.quotaBytes }),
      }),
    );
  }

  const path = ticket.value.storagePath;
  const ticketId = ticket.value.ticketId;
  if (path === null || ticketId === null) {
    return err(AppError.internal({ details: { reason: "ticket émis sans chemin" } }));
  }

  const signed = await createSignedUploadUrl(STORAGE_BUCKET_DOCUMENTS, path);
  if (!signed.ok) return signed;

  return ok({
    ticketId,
    uploadUrl: signed.value.signedUrl,
    token: signed.value.token,
    storagePath: path,
    bucket: STORAGE_BUCKET_DOCUMENTS,
    normalizedFilename: ticket.value.normalizedFilename ?? "",
    version: ticket.value.version ?? 1,
    expiresInSeconds: ticket.value.expiresInSeconds ?? 900,
  });
}

export interface ConfirmRequest {
  readonly ticketId: string;
  /** Empreinte calculée par le navigateur (Web Crypto) sur les octets envoyés. */
  readonly sha256: string;
}

export interface ConfirmedUpload {
  readonly documentId: string;
  readonly normalizedFilename: string;
  readonly version: number;
}

export async function confirmUpload(request: ConfirmRequest): Promise<Result<ConfirmedUpload>> {
  const context = await requirePermission("document.upload");
  if (!context.ok) return context;

  const ticket = await getUploadTicket(request.ticketId);
  if (!ticket.ok) return ticket;

  const head = await fetchObjectHead(ticket.value.bucket, ticket.value.storagePath);
  if (!head.ok) {
    // Pas d'objet au chemin promis : le billet n'a pas servi. On le referme pour
    // qu'il ne bloque ni le quota ni la numérotation de version.
    await rejectUploadTicket(request.ticketId, "objet absent du stockage");
    return err(AppError.validationFailed({ reason: "UPLOAD_NOT_FOUND" }));
  }

  // ── Le contrôle qui compte ────────────────────────────────────────────────
  // Il porte sur les octets RÉELLEMENT STOCKÉS. Un client peut annoncer un PDF,
  // passer tous les contrôles d'émission, puis téléverser un exécutable : seule
  // cette relecture l'attrape.
  const inspection = inspectHeader(
    ticket.value.originalFilename,
    ticket.value.declaredMimeType,
    head.value.bytes,
  );

  if (inspection.rejection !== null) {
    return refuse(request.ticketId, inspection.rejection);
  }

  if (head.value.totalSize !== ticket.value.declaredSizeBytes) {
    return refuse(request.ticketId, "SIZE_MISMATCH");
  }

  const confirmed = await confirmUploadRow({
    ticketId: request.ticketId,
    sha256: request.sha256.toLowerCase(),
    detectedMimeType: canonicalMimeOfFamily(inspection.detectedMimeFamily),
    actualSize: head.value.totalSize,
  });
  if (!confirmed.ok) return confirmed;

  if (confirmed.value.outcome !== "CREATED" || confirmed.value.documentId === null) {
    return err(AppError.validationFailed({ reason: confirmed.value.outcome }));
  }

  return ok({
    documentId: confirmed.value.documentId,
    normalizedFilename: confirmed.value.normalizedFilename ?? "",
    version: confirmed.value.version ?? 1,
  });
}

/**
 * Referme un billet sur un refus, et le dit à l'appelant.
 *
 * Le billet rejeté est CONSERVÉ : il porte la trace qu'un fichier démentant son
 * type annoncé a été envoyé, et il donne à la tâche de ménage le chemin de
 * l'objet à effacer du bucket.
 */
async function refuse(ticketId: string, reason: UploadRefusal): Promise<Result<never>> {
  await rejectUploadTicket(ticketId, `contrôle serveur : ${reason}`);
  return err(AppError.validationFailed({ reason }));
}

/**
 * Retrait d'une pièce.
 *
 * Motif OBLIGATOIRE : une pièce justificative qui disparaît sans explication
 * transforme un dossier vérifiable en dossier douteux. Le refus sur dossier
 * archivé est porté par `soft_delete_document()`, pas ici — une garde en base
 * vaut mieux qu'une garde applicative contournable par un autre appelant.
 */
export async function removeDocument(documentId: string, reason: string): Promise<Result<boolean>> {
  const context = await requirePermission("document.delete");
  if (!context.ok) return context;

  const trimmed = reason.trim();
  if (trimmed.length < 10) {
    return err(AppError.validationFailed({ field: "reason", reason: "REASON_TOO_SHORT" }));
  }

  return softDeleteDocument(toDocumentId(documentId), trimmed);
}

export type { UploadTicket };
