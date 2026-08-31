/**
 * Émission d'une URL signée de lecture d'un document.
 *
 * Seul chemin d'accès aux pièces : le bucket est privé, aucune URL publique
 * n'existe. Le handler vérifie les droits (via la RLS, appliquée dans le service)
 * ET journalise l'émission avant de rendre l'URL.
 *
 * POST plutôt que GET : l'appel a un effet de bord — il inscrit une ligne dans le
 * journal d'accès — et ne doit donc être ni mis en cache ni préchargé par le
 * navigateur.
 */

import { NextResponse, type NextRequest } from "next/server";

import { toClientError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { issueSignedDocumentUrl, type DocumentAccessAction } from "@/services/documents/signed-url";
import { toDocumentId } from "@/types/domain";

const ALLOWED_ACTIONS: readonly DocumentAccessAction[] = ["SIGNED_URL_ISSUED", "VIEW", "DOWNLOAD"];

function readAction(value: string | null): DocumentAccessAction {
  const match = ALLOWED_ACTIONS.find((action) => action === value);
  return match ?? "SIGNED_URL_ISSUED";
}

/** IP de l'appelant derrière le proxy de l'hébergeur. */
function readClientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded !== null && forwarded.length > 0) {
    const [first] = forwarded.split(",");
    return first?.trim() ?? null;
  }
  return request.headers.get("x-real-ip");
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> },
): Promise<NextResponse> {
  const { documentId } = await context.params;
  const url = new URL(request.url);

  const result = await issueSignedDocumentUrl({
    // Frontière : le segment d'URL est une chaîne quelconque tant qu'on ne l'a pas
    // marquée. La validité de l'uuid est vérifiée par la requête elle-même.
    documentId: toDocumentId(documentId),
    action: readAction(url.searchParams.get("action")),
    ipAddress: readClientIp(request),
    userAgent: request.headers.get("user-agent"),
    asAttachment: url.searchParams.get("download") === "1",
  });

  if (!result.ok) {
    logger.warn("Émission d'URL signée refusée", {
      documentId,
      code: result.error.code,
    });
    const clientError = toClientError(result.error);
    return NextResponse.json(clientError, { status: clientError.httpStatus });
  }

  return NextResponse.json(result.value, {
    status: 200,
    // L'URL est nominative et à durée courte : elle ne doit être conservée par
    // aucun intermédiaire.
    headers: { "Cache-Control": "no-store, private" },
  });
}
