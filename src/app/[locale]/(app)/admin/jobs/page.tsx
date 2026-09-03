import { getTranslations } from "next-intl/server";

import { SectionHeader } from "@/components/layout/section";
import { ErrorState } from "@/components/shared/states";
import { getJobHealth, getRecentJobRuns } from "@/services/admin/jobs";
import { JobsView } from "@/features/admin/components/jobs-view";
import { requireSectionAccess } from "@/services/navigation/guard";

/**
 * Surveillance des travaux planifiés.
 *
 * ⚠️ L'écran qui manquait. La génération d'occurrences, l'envoi des
 * notifications et la sauvegarde tournent sans témoin : quand l'un d'eux
 * s'arrête, la plateforme ne se casse pas — elle se fige. Les échéances du mois
 * suivant n'apparaissent jamais, les relances ne partent plus, et tout continue
 * d'avoir l'air normal jusqu'au jour où une déclaration manque.
 *
 * Aucune donnée métier ici : des noms de tâches, des horodatages, des
 * compteurs. La vue `job_health` reste soumise à la RLS de `job_runs`.
 */
export default async function Page() {
  await requireSectionAccess("/admin/jobs");

  const t = await getTranslations("admin.jobs");
  const [health, runs] = await Promise.all([getJobHealth(), getRecentJobRuns()]);

  if (!health.ok || !runs.ok) {
    return (
      <>
        <SectionHeader titleKey="adminJobs" descriptionKey="adminJobs" />
        <ErrorState title={t("loadFailed")} />
      </>
    );
  }

  return (
    <>
      <SectionHeader titleKey="adminJobs" descriptionKey="adminJobs" />
      <JobsView health={health.value} runs={runs.value} />
    </>
  );
}
