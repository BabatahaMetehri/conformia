/**
 * Surface publique de la feature « notifications ».
 *
 * ⚠️ Seul point d'entrée : importer un chemin interne depuis une autre feature
 * est interdit (CLAUDE.md §4). Ce qui n'est pas listé ici est un détail
 * d'implémentation, et doit pouvoir changer sans prévenir personne.
 */

export { CalendarFeedCard } from "./components/calendar-feed-card";
export { NotificationCenter } from "./components/notification-center";
export { NotificationPanel } from "./components/notification-panel";
export { PreferencesForm } from "./components/preferences-form";
export type { CalendarFeedView, ChannelPreference, InboxItem } from "./actions/types";
