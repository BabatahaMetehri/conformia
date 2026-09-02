import { getTranslations } from "next-intl/server";

import { SectionHeader } from "@/components/layout/section";
import { ErrorState } from "@/components/shared/states";
import { CalendarFeedCard } from "@/features/notifications";
import { formatDateTimeFr } from "@/lib/dates";
import { requireSectionAccess } from "@/services/navigation/guard";
import { ownCalendarFeed } from "@/services/notifications/inbox";

/**
 * Abonnement iCalendar de l'utilisateur.
 *
 * La garde précède TOUT rendu : un accès refusé produit l'écran « introuvable »,
 * jamais un écran « accès refusé » (cf. `src/services/navigation/guard.ts`).
 */
export default async function Page() {
  await requireSectionAccess("/profile/calendar");

  const t = await getTranslations();
  const feed = await ownCalendarFeed();

  return (
    <>
      <SectionHeader titleKey="calendarFeed" descriptionKey="calendarFeed" />
      {feed.ok ? (
        <CalendarFeedCard
          initialUrl={feed.value.url}
          rotatedAt={
            feed.value.rotatedAt === null ? null : formatDateTimeFr(new Date(feed.value.rotatedAt))
          }
        />
      ) : (
        <ErrorState title={t("notifications.errors.loadFailed")} />
      )}
    </>
  );
}
