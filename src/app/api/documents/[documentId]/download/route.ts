/**
 * Consultation et téléchargement d'une pièce.
 *
 * Enchaînement, dans cet ordre exact :
 *   authentification → permission → accès à l'occurrence → JOURNALISATION →
 *   URL signée de 300 s → redirection.
 *
 * ⚠️ La journalisation précède l'émission de l'URL, et partage sa transaction :
 * si la trace ne peut pas s'écrire, aucune URL n'est délivrée. Une lecture
 * invisible vaudrait moins qu'une lecture refusée.
 *
 * ⚠️ Le chemin de stockage n'est JAMAIS rendu au client. Il ne figure ni dans la
 * réponse, ni dans un en-tête, ni dans l'URL signée telle que le navigateur la
 * reçoit — celle-ci porte un jeton, pas une arborescence.
 *
 * GET, et non POST comme pour l'ancienne route d'URL signée : c'est ce que suit
 * un lien, ce qu'ouvre un onglet, et ce qu'un lecteur PDF embarqué sait charger.
 * L'effet de bord — une ligne de journal — est assumé et voulu à chaque ouverture ;
 * `Cache-Control: no-store` empêche qu'une consultation ultérieure soit servie
 * depuis le cache du navigateur sans laisser de trace.
 */

import { NextResponse, type NextRequest } from "next/server";

import { logger } from "@/lib/logger";
import { issueSignedDocumentUrl } from "@/services/documents/signed-url";
import { toDocumentId } from "@/types/domain";

/** IP de l'appelant derrière le proxy de l'hébergeur. */
function readClientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded !== null && forwarded.length > 0) {
    const [first] = forwarded.split(",");
    return first?.trim() ?? null;
  }
  return request.headers.get("x-real-ip");
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> },
): Promise<NextResponse> {
  const { documentId } = await context.params;
  const url = new URL(request.url);

  // Deux gestes distincts, deux traces distinctes : ouvrir une pièce dans le
  // navigateur n'est pas l'emporter sur son poste. Le journal doit pouvoir
  // répondre à « qui a EXPORTÉ cette déclaration », pas seulement « qui l'a vue ».
  const asAttachment = url.searchParams.get("mode") !== "inline";

  const result = await issueSignedDocumentUrl({
    // Frontière : le segment d'URL est une chaîne quelconque tant qu'on ne l'a
    // pas marquée. La validité de l'uuid est vérifiée par la requête elle-même.
    documentId: toDocumentId(documentId),
    action: asAttachment ? "DOWNLOAD" : "VIEW",
    ipAddress: readClientIp(request),
    userAgent: request.headers.get("user-agent"),
    asAttachment,
  });

  if (!result.ok) {
    logger.warn("Accès document refusé", { documentId, code: result.error.code });

    // 403 pour un refus de droit, 404 pour une pièce absente. La politique de
    // lecture rend déjà « absent » et « interdit » indistinguables en amont :
    // ce qui remonte ici en NOT_FOUND peut être l'un ou l'autre, et c'est voulu.
    const status = result.error.code === "FORBIDDEN" ? 403 : result.error.httpStatus;
    return NextResponse.json({ code: result.error.code }, { status });
  }

  // 302 : l'URL signée est éphémère, le navigateur ne doit pas la mémoriser
  // comme destination durable de cette adresse.
  return NextResponse.redirect(result.value.url, {
    status: 302,
    headers: { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" },
  });
}
