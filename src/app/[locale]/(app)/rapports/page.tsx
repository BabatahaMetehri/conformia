import { getTranslations } from "next-intl/server";

import { SectionHeader } from "@/components/layout/section";
import { ErrorState } from "@/components/shared/states";
import { ReportsView } from "@/features/reports";
import { getFormOptions } from "@/services/obligations";
import { requireSectionAccess } from "@/services/navigation/guard";

/**
 * Rapports et exports.
 *
 * La garde précède TOUT rendu : un accès refusé produit l'écran « introuvable »,
 * jamais un écran « accès refusé » (cf. `src/services/navigation/guard.ts`).
 * L'écran est réservé à `export.generate` par l'arbre de navigation, et la base
 * le revérifie à chaque ouverture d'export.
 */
export default async function Page() {
  await requireSectionAccess("/rapports");

  const t = await getTranslations();
  const options = await getFormOptions();

  return (
    <>
      <SectionHeader titleKey="reports" descriptionKey="reports" />
      {options.ok ? (
        <ReportsView
          domains={options.value.domains.map((domain) => ({
            id: domain.id,
            label: domain.label,
          }))}
          authorities={options.value.authorities.map((authority) => ({
            id: authority.id,
            name: authority.name,
          }))}
        />
      ) : (
        <ErrorState title={t("exports.page.failed")} />
      )}
    </>
  );
}
