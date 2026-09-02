import "server-only";

/**
 * Courrier de l'utilisateur : ce que la cloche et le panneau consultent.
 *
 * ⚠️ Aucune vérification de droit ici, et c'est délibéré. La politique RLS de
 * `notifications` borne déjà toute lecture et toute écriture au destinataire —
 * « on ne lit que ses propres messages, aucune exception ». Répéter le contrôle
 * en TypeScript créerait un second endroit où le cloisonnement pourrait devenir
 * faux, sans en créer un seul où il devienne plus vrai.
 */

import {
  countUnread,
  dismiss,
  listInbox,
  loadOwnIcsToken,
  loadPreferences,
  markAllRead,
  markRead,
  regenerateIcsToken,
  savePreference,
  type ChannelPreference,
  type InboxItem,
} from "@/data/queries/notifications";
import { NOTIFICATION_CHANNELS, type NotificationChannel } from "@/config/constants";
import { calendarFeedUrl } from "@/services/notifications/calendar";
import { ok, type Result } from "@/lib/result";

export type { ChannelPreference, InboxItem };

/** Ce que le panneau déroulant affiche : court, non lu d'abord. */
export const PANEL_SIZE = 8;

/** Ce que la page complète affiche d'un coup. */
export const PAGE_SIZE = 50;

export function loadPanel(): Promise<Result<readonly InboxItem[]>> {
  return listInbox(PANEL_SIZE, true);
}

export function loadPage(includeRead: boolean): Promise<Result<readonly InboxItem[]>> {
  return listInbox(PAGE_SIZE, includeRead);
}

/**
 * Compteur de la cloche.
 *
 * ⚠️ `null` signifie « on ne sait pas », et se distingue de 0. Afficher un zéro
 * sur une lecture ratée affirmerait qu'il n'y a rien à lire — c'est la promesse
 * que le composant tient depuis sa première version, quand la table n'existait
 * pas encore.
 */
export function unreadCount(): Promise<number | null> {
  return countUnread();
}

export function readOne(id: number): Promise<Result<number>> {
  return markRead([id]);
}

export function readAll(): Promise<Result<number>> {
  return markAllRead();
}

export function hide(id: number): Promise<Result<void>> {
  return dismiss(id);
}

/**
 * Préférences complétées par les valeurs par défaut.
 *
 * ⚠️ L'absence de ligne vaut « activé ». L'écran doit montrer l'état RÉEL, donc
 * afficher un canal actif là où rien n'est enregistré — un interrupteur éteint
 * pour un canal qui fonctionne serait un mensonge que l'utilisateur corrigerait
 * dans le mauvais sens.
 */
export async function preferencesWithDefaults(): Promise<Result<readonly ChannelPreference[]>> {
  const stored = await loadPreferences();
  if (!stored.ok) return stored;

  const byChannel = new Map(stored.value.map((preference) => [preference.channel, preference]));

  return ok(
    NOTIFICATION_CHANNELS.map(
      (channel: NotificationChannel): ChannelPreference =>
        byChannel.get(channel) ?? {
          channel,
          isEnabled: true,
          digestFrequency: "WEEKLY",
        },
    ),
  );
}

export function updatePreference(
  userId: string,
  preference: ChannelPreference,
): Promise<Result<void>> {
  return savePreference(userId, preference);
}

// ─── Flux calendrier ─────────────────────────────────────────────────────────

export interface CalendarFeedView {
  readonly token: string;
  readonly url: string;
  readonly rotatedAt: string | null;
}

export async function ownCalendarFeed(): Promise<Result<CalendarFeedView>> {
  const stored = await loadOwnIcsToken();
  if (!stored.ok) return stored;
  return ok({
    token: stored.value.token,
    url: calendarFeedUrl(stored.value.token),
    rotatedAt: stored.value.rotatedAt,
  });
}

export async function rotateCalendarFeed(): Promise<Result<CalendarFeedView>> {
  const token = await regenerateIcsToken();
  if (!token.ok) return token;
  // La rotation vient d'avoir lieu : inutile de relire la ligne pour l'apprendre.
  return ok({
    token: token.value,
    url: calendarFeedUrl(token.value),
    rotatedAt: new Date().toISOString(),
  });
}
