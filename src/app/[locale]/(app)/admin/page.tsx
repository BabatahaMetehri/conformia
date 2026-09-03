import { getTranslations } from "next-intl/server";

import { SectionHeader } from "@/components/layout/section";
import { ErrorState } from "@/components/shared/states";
import { AdminHub } from "@/features/admin/components/admin-hub";
import { getResolvedNavigation } from "@/services/navigation";
import { requireSectionAccess } from "@/services/navigation/guard";

/**
 * Sommaire de l'administration.
 *
 * ⚠️ Les sections listées viennent de l'arbre de navigation DÉJÀ filtré par les
 * permissions : ce sommaire ne peut pas montrer plus que la barre latérale.
 * C'est ce qui garantit qu'il n'y a qu'UNE formulation des droits d'accès.
 */
export default async function Page() {
  await requireSectionAccess("/admin");

  const t = await getTranslations("admin.hub");
  const navigation = await getResolvedNavigation();

  if (!navigation.ok) {
    return (
      <>
        <SectionHeader titleKey="admin" descriptionKey="admin" />
        <ErrorState title={t("loadFailed")} />
      </>
    );
  }

  const adminNode = navigation.value.items.find((item) => item.id === "admin");

  return (
    <>
      <SectionHeader titleKey="admin" descriptionKey="admin" />
      <AdminHub sections={adminNode?.children ?? []} />
    </>
  );
}
