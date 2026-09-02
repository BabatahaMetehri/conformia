/**
 * Flux iCalendar d'un utilisateur.
 *
 * ⚠️ ROUTE PUBLIQUE, authentifiée par le SEUL jeton de l'URL. Ce n'est pas un
 * relâchement : un agenda — Outlook, Google, Apple — s'abonne par une requête
 * GET anonyme et ne sait présenter ni cookie, ni en-tête, ni certificat. Le
 * jeton dans le chemin est la seule authentification que le format autorise.
 *
 * Ce qui rend le compromis acceptable, et qui doit le rester :
 *  • le cloisonnement est réappliqué EN BASE pour le porteur du jeton ;
 *  • le flux ne porte que libellé, période, échéance, statut, organisme ;
 *  • le jeton est régénérable en un clic, et la rotation invalide l'ancien flux
 *    à l'instant même.
 *
 * ⚠️ La réponse n'est JAMAIS mise en cache par un intermédiaire. Un flux
 * personnel servi depuis un cache partagé livrerait l'échéancier d'un
 * utilisateur à un autre — la seule façon de transformer un compromis maîtrisé
 * en fuite.
 */

import { NextResponse } from "next/server";

import { buildCalendarFeed } from "@/services/notifications/calendar";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Un UUID, et rien d'autre. */
const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Calendrier vide.
 *
 * ⚠️ Rendu pour un jeton malformé, inconnu OU révoqué — indistinctement, et avec
 * le même code 200. Répondre 404 sur un jeton inconnu et 200 sur un jeton valide
 * en ferait un oracle : on pourrait éprouver des jetons au hasard et reconnaître
 * les bons. Un agenda qui reçoit un calendrier vide, lui, n'affiche simplement
 * rien.
 */
const EMPTY_CALENDAR = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//AGROESPACE//CONFORMIA//FR",
  "CALSCALE:GREGORIAN",
  "METHOD:PUBLISH",
  "END:VCALENDAR",
  "",
].join("\r\n");

function calendarResponse(body: string): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      // `private` : jamais dans un cache partagé. `no-store` : jamais sur disque.
      "Cache-Control": "private, no-store, max-age=0",
      // Le flux n'est pas une page : aucun agenda ne l'interprète comme du HTML,
      // mais un navigateur qui ouvrirait l'URL, si.
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": 'inline; filename="conformia.ics"',
    },
  });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await context.params;

  if (!TOKEN_PATTERN.test(token)) {
    // Journalisé sans la valeur : un jeton, même invalide, n'a pas sa place dans
    // un fichier de journal que l'exploitation relit.
    logger.warn("Flux calendrier : jeton malformé", { length: token.length });
    return calendarResponse(EMPTY_CALENDAR);
  }

  const feed = await buildCalendarFeed(token, new Date());

  if (!feed.ok) {
    logger.error("Flux calendrier indisponible", { code: feed.error.code });
    // Même en cas d'échec technique : un agenda abonné doit recevoir un
    // calendrier, pas une erreur qui le ferait se désabonner tout seul.
    return calendarResponse(EMPTY_CALENDAR);
  }

  return calendarResponse(feed.value);
}
