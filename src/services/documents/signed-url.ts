import "server-only";

/**
 * Émission d'une URL signée de lecture.
 *
 * Aucun document n'est accessible autrement : le bucket est privé et ne sert
 * aucune URL publique. L'émission est journalisée AVANT d'être rendue — si la
 * trace ne peut pas être écrite, l'URL n'est pas délivrée. Une lecture invisible
 * vaudrait moins qu'une lecture refusée.
 */

import { flatMapResult, type Result } from "@/lib/result";
import { createSignedUrl, getDocumentById, getSignedUrlTtlSeconds } from "@/data/queries/documents";
import { logDocumentAccess, type DocumentAccessAction } from "@/data/mutations/documents";
import type { DocumentId } from "@/types/domain";

export type { DocumentAccessAction };

export interface SignedUrlRequest {
  readonly documentId: DocumentId;
  readonly action: DocumentAccessAction;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  /** `true` force le téléchargement plutôt que l'affichage en ligne. */
  readonly asAttachment: boolean;
}

export interface SignedDocumentUrl {
  readonly url: string;
  readonly expiresInSeconds: number;
  readonly filename: string;
}

export async function issueSignedDocumentUrl(
  request: SignedUrlRequest,
): Promise<Result<SignedDocumentUrl>> {
  // La RLS décide de la visibilité : un document d'un autre domaine ne remonte pas.
  const document = await getDocumentById(request.documentId);
  if (!document.ok) return document;

  const ttl = await getSignedUrlTtlSeconds();
  if (!ttl.ok) return ttl;

  const logged = await logDocumentAccess(request.documentId, request.action, {
    ipAddress: request.ipAddress,
    userAgent: request.userAgent,
  });
  if (!logged.ok) return logged;

  const signed = await createSignedUrl(document.value, ttl.value, request.asAttachment);

  return flatMapResult(signed, (url) => ({
    ok: true,
    value: {
      url,
      expiresInSeconds: ttl.value,
      filename: document.value.normalizedFilename,
    },
  }));
}
