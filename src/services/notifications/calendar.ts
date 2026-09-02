import "server-only";

/**
 * Flux calendrier — l'échéancier là où les gens regardent réellement leur
 * journée.
 *
 * ⚠️ CE FLUX EST LU SANS SESSION. Son unique authentification est le jeton dans
 * l'URL, et c'est une contrainte du format : aucun agenda grand public ne sait
 * présenter autre chose. Deux conséquences, toutes deux structurelles :
 *
 *  • la RLS est réappliquée EN BASE pour le porteur du jeton (`calendar_feed`),
 *    jamais reconstituée ici — un filtre écrit en TypeScript serait un second
 *    cloisonnement, donc un cloisonnement de plus à maintenir juste ;
 *  • le contenu est réduit à ce qui peut circuler en clair : libellé, période,
 *    échéance, statut, organisme. Aucun document, aucun montant, aucun
 *    commentaire.
 */

import { CALENDAR_ALARM_DAYS_BEFORE, CALENDAR_FEED_MONTHS } from "@/config/notifications";
import { DEFAULT_LOCALE } from "@/config/constants";
import { env } from "@/config/env";
import { loadCalendarFeed } from "@/data/queries/notifications";
import { emailTranslator } from "@/emails/translator";
import { serializeCalendar, type CalendarEvent } from "@/lib/icalendar";
import { err, ok, type Result } from "@/lib/result";

/**
 * Construit le flux d'un porteur de jeton.
 *
 * Rend une chaîne iCalendar, vide d'événements si le jeton ne correspond à
 * personne. ⚠️ Un jeton inconnu ne produit PAS d'erreur : un 404 distinguerait
 * un jeton révoqué d'un jeton inexistant, ce qui permettrait d'en éprouver la
 * validité. Un calendrier vide ne dit rien.
 */
export async function buildCalendarFeed(token: string, now: Date): Promise<Result<string>> {
  const entries = await loadCalendarFeed(token, CALENDAR_FEED_MONTHS);
  if (!entries.ok) return err(entries.error);

  const t = emailTranslator(DEFAULT_LOCALE);

  const events: CalendarEvent[] = entries.value.map((entry) => ({
    // ⚠️ UID STABLE, dérivé de l'occurrence. C'est lui qui fait qu'un
    // rafraîchissement met l'événement à jour au lieu d'en ajouter un second :
    // un UID tiré au hasard remplirait l'agenda d'un doublon toutes les deux
    // heures.
    uid: `occurrence-${entry.occurrenceId}@conformia.agroespace.dz`,
    // L'échéance INTERNE, pas la légale : c'est la date à laquelle le dossier
    // doit être prêt, donc celle qui appelle une action ce jour-là.
    date: entry.internalDueDate,
    summary: t("calendar.event.summary", {
      code: entry.obligationCode,
      name: entry.obligationName,
    }),
    description: t("calendar.event.description", {
      authority: entry.authorityName ?? t("calendar.event.noAuthority"),
      status: t(`occurrences.status.${entry.status}`),
      period: entry.periodKey,
      legalDue: entry.legalDueDate,
      url: `${env.NEXT_PUBLIC_APP_URL}/${DEFAULT_LOCALE}/echeancier/${entry.occurrenceId}`,
    }),
    alarmDaysBefore: CALENDAR_ALARM_DAYS_BEFORE,
    alarmText: t("calendar.event.alarm", { name: entry.obligationName }),
    lastModified: new Date(entry.updatedAt),
  }));

  return ok(
    serializeCalendar({
      name: t("calendar.feed.name"),
      description: t("calendar.feed.description"),
      events,
      stamp: now,
    }),
  );
}

/** URL publique du flux d'un jeton. Affichée dans le menu utilisateur. */
export function calendarFeedUrl(token: string): string {
  return `${env.NEXT_PUBLIC_APP_URL}/api/calendar/${token}`;
}
