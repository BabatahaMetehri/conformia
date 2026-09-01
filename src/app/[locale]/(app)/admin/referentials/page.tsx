import { getTranslations } from "next-intl/server";

import { SectionHeader } from "@/components/layout/section";
import { ErrorState } from "@/components/shared/states";
import { ReferentialsView } from "@/features/admin/components/referentials-view";
import { requirePermission } from "@/services/auth/context";
import { getHolidays, getReferentials } from "@/services/admin";
import { requireSectionAccess } from "@/services/navigation/guard";

/**
 * Référentiels : organismes, domaines, services, jours fériés.
 *
 * ⚠️ Le calendrier commence à l'année EN COURS : les jours fériés passés ne
 * déplacent plus rien, et les afficher noierait ceux qui comptent.
 */
export default async function Page() {
  await requireSectionAccess("/admin/referentials");

  const t = await getTranslations("admin.referentials");
  const currentYear = new Date().getUTCFullYear();

  const [holidays, referentials, canManage] = await Promise.all([
    getHolidays(currentYear),
    getReferentials(),
    requirePermission("referential.manage"),
  ]);

  if (!holidays.ok || !referentials.ok) {
    return (
      <>
        <SectionHeader titleKey="adminReferentials" descriptionKey="adminReferentials" />
        <ErrorState title={t("loadFailed")} />
      </>
    );
  }

  return (
    <>
      <SectionHeader titleKey="adminReferentials" descriptionKey="adminReferentials" />
      <ReferentialsView
        holidays={holidays.value}
        referentials={referentials.value}
        canManage={canManage.ok}
        currentYear={currentYear}
      />
    </>
  );
}
