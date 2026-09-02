/**
 * Sérialiseur iCalendar (RFC 5545).
 *
 * ⚠️ FONCTIONS PURES. Ni Supabase, ni React, ni horloge implicite : le flux se
 * teste caractère par caractère, ce qui est la seule façon raisonnable de
 * vérifier un format que les agendas rejettent en bloc et sans message.
 *
 * ⚠️ Pas de dépendance non plus. Une bibliothèque iCalendar apporterait des
 * fuseaux, des récurrences et des pièces jointes dont ce flux n'a aucun usage,
 * pour un besoin qui tient en quatre-vingts lignes : des événements d'une
 * journée, sans récurrence, sans invité, sans fichier.
 */

/** Fin de ligne imposée par la RFC. Un simple `\n` fait rejeter le flux par Outlook. */
const CRLF = "\r\n";

/** Longueur maximale d'une ligne, en octets, avant pliage. */
const MAX_OCTETS = 75;

/**
 * Échappe une valeur de texte.
 *
 * L'ordre compte : la barre oblique inverse d'abord, sinon on échapperait les
 * barres que l'on vient soi-même d'introduire.
 */
export function escapeText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll(/\r?\n/g, "\\n");
}

/**
 * Plie une ligne à 75 octets, la suite étant préfixée d'une espace.
 *
 * ⚠️ Le compte est en OCTETS, pas en caractères. Un nom d'obligation accentué —
 * « Déclaration mensuelle » — pèse plus que sa longueur apparente, et couper au
 * mauvais endroit produit un octet UTF-8 orphelin : l'agenda affiche alors un
 * caractère de remplacement, ou refuse le fichier entier.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= MAX_OCTETS) return line;

  const segments: string[] = [];
  let current = "";
  let currentOctets = 0;
  // La première ligne dispose de 75 octets, les suivantes de 74 : l'espace de
  // continuation en consomme un.
  let limit = MAX_OCTETS;

  for (const character of line) {
    const size = encoder.encode(character).length;
    if (currentOctets + size > limit) {
      segments.push(current);
      current = "";
      currentOctets = 0;
      limit = MAX_OCTETS - 1;
    }
    current += character;
    currentOctets += size;
  }

  if (current.length > 0) segments.push(current);
  return segments.join(`${CRLF} `);
}

/** `YYYYMMDD`, à partir d'une date ISO `YYYY-MM-DD`. */
export function toIcsDate(isoDate: string): string {
  return isoDate.replaceAll("-", "");
}

/** Horodatage UTC `YYYYMMDDTHHMMSSZ`. */
export function toIcsTimestamp(instant: Date): string {
  return `${instant.toISOString().replaceAll(/[-:]/g, "").slice(0, 15)}Z`;
}

/** Lendemain d'une date ISO, pour le `DTEND` exclusif d'un événement d'un jour. */
export function nextIsoDay(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  // Midi UTC : à minuit, un décalage de fuseau ferait basculer la date d'un jour.
  const base = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, 12));
  base.setUTCDate(base.getUTCDate() + 1);
  return base.toISOString().slice(0, 10);
}

export interface CalendarEvent {
  /** Stable dans le temps : rejouer le flux met à jour l'événement, n'en crée pas un second. */
  readonly uid: string;
  readonly date: string;
  readonly summary: string;
  readonly description: string;
  /** Rappel, en jours pleins avant la date. `null` pour aucun. */
  readonly alarmDaysBefore: number | null;
  readonly alarmText: string;
  /** Dernière modification de l'occurrence : les agendas s'en servent pour rafraîchir. */
  readonly lastModified: Date;
}

export interface CalendarDocument {
  readonly name: string;
  readonly description: string;
  readonly events: readonly CalendarEvent[];
  readonly stamp: Date;
}

function eventLines(event: CalendarEvent): string[] {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    /*
     * ⚠️ Événement d'une JOURNÉE ENTIÈRE (`VALUE=DATE`), et non un rendez-vous à
     * une heure donnée. Une échéance administrative n'a pas d'heure : la poser à
     * 09 h 00 la ferait glisser d'un jour pour tout agenda réglé sur un autre
     * fuseau, ce qui est exactement l'erreur que ce produit existe pour éviter.
     * `DTEND` est EXCLUSIF : le lendemain, donc une seule journée occupée.
     */
    `DTSTART;VALUE=DATE:${toIcsDate(event.date)}`,
    `DTEND;VALUE=DATE:${toIcsDate(nextIsoDay(event.date))}`,
    `SUMMARY:${escapeText(event.summary)}`,
    `DESCRIPTION:${escapeText(event.description)}`,
    `LAST-MODIFIED:${toIcsTimestamp(event.lastModified)}`,
    // `TRANSP:TRANSPARENT` : l'échéance ne rend pas la journée « occupée ». Sans
    // cela, douze échéances rendraient l'agenda inutilisable pour les collègues
    // qui y cherchent une disponibilité.
    "TRANSP:TRANSPARENT",
  ];

  if (event.alarmDaysBefore !== null) {
    lines.push(
      "BEGIN:VALARM",
      `TRIGGER:-P${String(event.alarmDaysBefore)}D`,
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeText(event.alarmText)}`,
      "END:VALARM",
    );
  }

  lines.push("END:VEVENT");
  return lines;
}

/** Sérialise un calendrier complet. */
export function serializeCalendar(document: CalendarDocument): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AGROESPACE//CONFORMIA//FR",
    "CALSCALE:GREGORIAN",
    // `PUBLISH` : un flux en lecture, sans invitation ni réponse attendue.
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(document.name)}`,
    `X-WR-CALDESC:${escapeText(document.description)}`,
    // Rythme de rafraîchissement suggéré. Sans lui, certains agendas
    // n'interrogent le flux qu'une fois par jour, et une échéance déplacée
    // resterait fausse jusqu'au lendemain.
    "X-PUBLISHED-TTL:PT2H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT2H",
  ];

  const stamp = toIcsTimestamp(document.stamp);
  for (const event of document.events) {
    for (const line of eventLines(event)) {
      lines.push(line === "BEGIN:VEVENT" ? `${line}${CRLF}DTSTAMP:${stamp}` : line);
    }
  }

  lines.push("END:VCALENDAR");
  return (
    lines
      .flatMap((line) => line.split(CRLF))
      .map(foldLine)
      .join(CRLF) + CRLF
  );
}
