import "server-only";

/**
 * Dépôt d'une pièce sur un dossier.
 *
 * Ordre de priorité de CLAUDE.md §1 appliqué littéralement :
 *   1. confidentialité — bucket privé, chemin construit côté serveur ;
 *   2. traçabilité — l'insertion déclenche l'audit, le rattachement met à jour la pièce ;
 *   3. intégrité — empreinte au dépôt, versionnement, jamais d'écrasement en place ;
 *   4. confort — après les trois autres.
 *
 * ⚠️ L'objet est écrit AVANT la ligne. Si l'insertion échoue, l'objet reste
 * orphelin dans le bucket — inaccessible, puisque la politique de lecture de
 * storage.objects exige une ligne `documents` portant ce chemin. L'ordre inverse
 * produirait une ligne visible pointant vers un fichier absent : une pièce
 * fantôme dans un dossier de conformité, ce qui est bien pire qu'un octet perdu.
 */

import { randomUUID } from "node:crypto";

import {
  MAX_OCCURRENCE_TOTAL_MB,
  MAX_UPLOAD_MB,
  STORAGE_BUCKET_DOCUMENTS,
} from "@/config/constants";
import { getDepositContext, getSupersedeTarget } from "@/data/queries/documents";
import {
  insertDocument,
  uploadDocumentObject,
  softDeleteDocument,
} from "@/data/mutations/documents";
import { AppError } from "@/lib/errors";
import {
  buildNormalizedFilename,
  buildStoragePath,
  canonicalMimeOfFamily,
  extensionOf,
  inspectFile,
  sha256Hex,
} from "@/lib/files";
import { err, ok, type Result } from "@/lib/result";
import { requirePermission } from "@/services/auth/context";
import { toDocumentId } from "@/types/domain";

const MEGABYTE = 1024 * 1024;

export interface DepositRequest {
  readonly occurrenceId: string;
  /** Pièce attendue à laquelle rattacher le dépôt, ou `null` pour une pièce libre. */
  readonly checklistItemId: string | null;
  readonly pieceLabel: string;
  readonly documentKind: string | null;
  readonly filename: string;
  readonly declaredMimeType: string;
  readonly bytes: Uint8Array;
}

export interface DepositResult {
  readonly documentId: string;
  readonly normalizedFilename: string;
  readonly version: number;
}

export async function depositDocument(request: DepositRequest): Promise<Result<DepositResult>> {
  const context = await requirePermission("document.upload");
  if (!context.ok) return context;

  const deposit = await getDepositContext(request.occurrenceId);
  if (!deposit.ok) return deposit;

  // Un dossier archivé n'accepte plus de pièce. Le trigger enforce_occurrence_lock
  // protège l'occurrence, pas ses pièces : la garde est explicite ici.
  if (deposit.value.isLocked) {
    return err(AppError.validationFailed({ reason: "OCCURRENCE_LOCKED" }));
  }

  const inspection = inspectFile(
    request.filename,
    request.declaredMimeType,
    request.bytes,
    MAX_UPLOAD_MB * MEGABYTE,
  );

  if (inspection.rejection !== null) {
    return err(AppError.validationFailed({ reason: inspection.rejection }));
  }

  if (
    deposit.value.bytesAlreadyStored + request.bytes.length >
    MAX_OCCURRENCE_TOTAL_MB * MEGABYTE
  ) {
    return err(AppError.validationFailed({ reason: "OCCURRENCE_QUOTA_EXCEEDED" }));
  }

  const target = await getSupersedeTarget(request.occurrenceId, request.checklistItemId);
  if (!target.ok) return target;

  const documentId = randomUUID();
  const storagePath = buildStoragePath({
    entityCode: deposit.value.entityCode,
    domainCode: deposit.value.domainCode,
    obligationCode: deposit.value.obligationCode,
    periodKey: deposit.value.periodKey,
    documentId,
    originalFilename: request.filename,
  });

  const normalizedFilename = buildNormalizedFilename({
    obligationCode: deposit.value.obligationCode,
    periodKey: deposit.value.periodKey,
    documentKind: request.documentKind,
    pieceLabel: request.pieceLabel,
    version: target.value.version,
    extension: extensionOf(request.filename),
  });

  const sha256 = await sha256Hex(request.bytes);

  const uploaded = await uploadDocumentObject({
    bucket: STORAGE_BUCKET_DOCUMENTS,
    path: storagePath,
    bytes: request.bytes,
    contentType: request.declaredMimeType,
  });
  if (!uploaded.ok) return uploaded;

  const inserted = await insertDocument({
    id: documentId,
    occurrenceId: request.occurrenceId,
    checklistItemId: request.checklistItemId,
    bucket: STORAGE_BUCKET_DOCUMENTS,
    storagePath,
    originalFilename: request.filename,
    normalizedFilename,
    mimeType: request.declaredMimeType,
    // Ce qui fait foi n'est pas ce que le navigateur annonce, mais ce que les
    // premiers octets démontrent. Un écart aurait déjà été refusé plus haut.
    detectedMimeType: canonicalMimeOfFamily(inspection.detectedMimeFamily),
    sizeBytes: request.bytes.length,
    sha256,
    version: target.value.version,
    supersedesId: target.value.supersedesId,
    documentKind: request.documentKind,
    uploadedBy: context.value.userId,
  });
  if (!inserted.ok) return inserted;

  return ok({
    documentId: inserted.value,
    normalizedFilename,
    version: target.value.version,
  });
}

/**
 * Retrait d'une pièce.
 *
 * Motif OBLIGATOIRE : une pièce justificative qui disparaît sans explication
 * transforme un dossier vérifiable en dossier douteux.
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
