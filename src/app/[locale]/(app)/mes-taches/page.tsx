import { getTranslations } from "next-intl/server";

import { SectionHeader } from "@/components/layout/section";
import { ErrorState } from "@/components/shared/states";
import type { Criticality, OccurrenceStatus } from "@/config/constants";
import { MyTasksView } from "@/features/occurrences/components/my-tasks-view";
import { requireSectionAccess } from "@/services/navigation/guard";
import { getMyTasks } from "@/services/occurrences";

/**
 * Mes tâches.
 *
 * Toujours accessible : chacun a le droit de constater qu'on ne lui a rien
 * confié. La RLS borne le contenu à ses propres dossiers et à ceux qu'il valide.
 */
export default async function Page() {
  await requireSectionAccess("/mes-taches");

  const t = await getTranslations("occurrences");
  const groups = await getMyTasks();

  if (!groups.ok) {
    return (
      <>
        <SectionHeader titleKey="myTasks" descriptionKey="myTasks" />
        <ErrorState title={t("loadFailed")} />
      </>
    );
  }

  return (
    <>
      <SectionHeader titleKey="myTasks" descriptionKey="myTasks" />

      <MyTasksView
        groups={groups.value.map((group) => ({
          bucket: group.bucket,
          items: group.items.map((row) => ({
            id: row.id,
            obligationCode: row.obligationCode,
            obligationName: row.obligationName,
            periodKey: row.periodKey,
            internalDueDate: row.internalDueDate,
            legalDueDate: row.legalDueDate,
            daysToInternal: row.daysToInternal,
            daysToLegal: row.daysToLegal,
            isOverdue: row.isOverdue,
            isInternallyLate: row.isInternallyLate,
            status: row.status as OccurrenceStatus,
            ownerName: row.ownerName,
            validatorName: row.validatorName,
            documentsProvided: row.documentsProvided,
            documentsRequired: row.documentsRequired,
            criticality: row.criticality as Criticality,
            rectificationIndex: row.rectificationIndex,
            isLocked: row.isLocked,
            domainLabel: row.domainLabel,
            obligationScope: row.obligationScope,
            registerNumber: row.registerNumber,
          })),
        }))}
      />
    </>
  );
}
