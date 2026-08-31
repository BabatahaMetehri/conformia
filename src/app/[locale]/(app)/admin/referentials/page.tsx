import { SectionHeader, SectionPlaceholder } from "@/components/layout/section";
import { requireSectionAccess } from "@/services/navigation/guard";

/**
 * Coquille de section. La garde précède TOUT rendu : un accès refusé produit
 * l'écran « introuvable », jamais un écran « accès refusé »
 * (cf. `src/services/navigation/guard.ts`).
 */
export default async function Page() {
  await requireSectionAccess("/admin/referentials");

  return (
    <>
      <SectionHeader titleKey="adminReferentials" descriptionKey="adminReferentials" />
      <SectionPlaceholder />
    </>
  );
}
