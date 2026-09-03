import { getTranslations } from "next-intl/server";

import { SectionHeader } from "@/components/layout/section";
import { ErrorState } from "@/components/shared/states";
import { AbsencesView } from "@/features/absences/components/absences-view";
import { formatISODateInAppTz } from "@/lib/dates";
import { getAbsences, getAssignablePeople } from "@/services/absences";
import { getAuthContext } from "@/services/auth/context";
import { requireSectionAccess } from "@/services/navigation/guard";

/**
 * Déclarations d'absence.
 *
 * ⚠️ LA DATE DU JOUR EST CALCULÉE AU SERVEUR, à l'heure d'Alger. Prise sur le
 * poste client, elle serait celle de son fuseau : une absence saisie depuis
 * l'étranger commencerait la veille ou le lendemain, et l'écart d'un jour ne se
 * voit qu'en production.
 */
export default async function Page() {
  await requireSectionAccess("/absences");

  const t = await getTranslations("absences");
  const [absences, people, context] = await Promise.all([
    getAbsences(),
    getAssignablePeople(),
    getAuthContext(),
  ]);

  if (!absences.ok || !context.ok || context.value === null) {
    return (
      <>
        <SectionHeader titleKey="absences" descriptionKey="absences" />
        <ErrorState title={t("loadFailed")} />
      </>
    );
  }

  return (
    <>
      <SectionHeader titleKey="absences" descriptionKey="absences" />
      <AbsencesView
        absences={absences.value}
        people={people.ok ? people.value : []}
        currentUserId={context.value.userId}
        canManageOthers={context.value.permissions.has("absence.manage")}
        today={formatISODateInAppTz()}
      />
    </>
  );
}
