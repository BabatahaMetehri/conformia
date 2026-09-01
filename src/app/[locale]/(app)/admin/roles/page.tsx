import { getTranslations } from "next-intl/server";

import { SectionHeader } from "@/components/layout/section";
import { ErrorState } from "@/components/shared/states";
import { RolesMatrix } from "@/features/admin/components/roles-matrix";
import { getRoleMatrix } from "@/services/admin";
import { requireSectionAccess } from "@/services/navigation/guard";

/**
 * Matrice rôles × permissions.
 *
 * ⚠️ Cet écran REND MODIFIABLE ce que 0002 avait délibérément figé. Le compromis
 * est décrit dans la migration 0011 : édition réservée à `role.manage`, rôles
 * système protégés par trigger, chaque case auditée. La note affichée en tête
 * existe pour empêcher un futur administrateur de « corriger » l'absence
 * volontaire de `occurrence.read` chez ADMIN.
 */
export default async function Page() {
  await requireSectionAccess("/admin/roles");

  const t = await getTranslations("admin.roles");
  const matrix = await getRoleMatrix();

  if (!matrix.ok) {
    return (
      <>
        <SectionHeader titleKey="adminRoles" descriptionKey="adminRoles" />
        <ErrorState title={t("loadFailed")} />
      </>
    );
  }

  return (
    <>
      <SectionHeader titleKey="adminRoles" descriptionKey="adminRoles" />
      <RolesMatrix matrix={matrix.value} />
    </>
  );
}
