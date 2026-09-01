import { getTranslations } from "next-intl/server";

import { SectionHeader } from "@/components/layout/section";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { PurgeQueueTable } from "@/features/documents/components/purge-queue-table";
import { listPurgeQueue } from "@/services/documents/search";
import { requireSectionAccess } from "@/services/navigation/guard";

/**
 * File « Purge à examiner ».
 *
 * ⚠️ CET ÉCRAN NE SUPPRIME RIEN, et aucune tâche planifiée ne supprime à sa
 * place. Il liste les pièces ayant dépassé leur durée de conservation et attend
 * une décision humaine explicite, tracée par `deleted_by` et `deletion_reason`.
 *
 * Conséquence voulue de ce choix : un paramètre de rétention mal réglé ne peut
 * détruire aucune donnée — il ne peut qu'allonger une liste.
 */
export default async function Page() {
  await requireSectionAccess("/admin/purge");

  const t = await getTranslations("documents.purge");
  const rows = await listPurgeQueue();

  if (!rows.ok) {
    return (
      <>
        <SectionHeader titleKey="adminPurge" descriptionKey="adminPurge" />
        <ErrorState title={t("loadFailed")} />
      </>
    );
  }

  return (
    <>
      <SectionHeader titleKey="adminPurge" descriptionKey="adminPurge" />

      <p className="mb-4 rounded-lg border border-border bg-surface p-3 text-sm text-text-secondary">
        {t("intro")}
      </p>

      {rows.value.length === 0 ? (
        <EmptyState title={t("empty")} />
      ) : (
        <PurgeQueueTable rows={rows.value} />
      )}
    </>
  );
}
