import { getTranslations } from "next-intl/server";

import { SectionHeader } from "@/components/layout/section";
import { ErrorState } from "@/components/shared/states";
import { ValidationQueue } from "@/features/workflow";
import { BULK_VALIDATABLE_CRITICALITIES, getValidationQueue } from "@/services/workflow/queue";
import { requireSectionAccess } from "@/services/navigation/guard";

/**
 * File de validation.
 *
 * Server Component : les dossiers arrivent avec le HTML. Le tri — urgence puis
 * criticité — est fait côté serveur, pour que la première ligne soit la bonne
 * dès le premier octet affiché.
 *
 * ⚠️ Aucun filtre d'habilitation ici : la vue `validation_queue` applique
 * `can_validate_occurrence` (délégations comprises) et la séparation des
 * pouvoirs. Refiltrer créerait une seconde règle d'accès.
 */
export default async function Page() {
  await requireSectionAccess("/validation");

  const t = await getTranslations("workflow.queue");
  const rows = await getValidationQueue();

  if (!rows.ok) {
    return (
      <>
        <SectionHeader titleKey="validation" descriptionKey="validation" />
        <ErrorState title={t("loadFailed")} />
      </>
    );
  }

  return (
    <>
      <SectionHeader titleKey="validation" descriptionKey="validation" />
      <ValidationQueue rows={rows.value} bulkCriticalities={BULK_VALIDATABLE_CRITICALITIES} />
    </>
  );
}
