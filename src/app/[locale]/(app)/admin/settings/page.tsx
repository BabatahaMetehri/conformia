import { getTranslations } from "next-intl/server";

import { SectionHeader } from "@/components/layout/section";
import { ErrorState } from "@/components/shared/states";
import { SettingsView } from "@/features/admin/components/settings-view";
import { getSettings } from "@/services/admin";
import { requireSectionAccess } from "@/services/navigation/guard";

/**
 * Réglages de l'installation.
 *
 * Chaque clé porte sa description et son type : la validation suit le type
 * DÉCLARÉ EN BASE, pas une liste tenue dans l'écran.
 */
export default async function Page() {
  await requireSectionAccess("/admin/settings");

  const t = await getTranslations("admin.settings");
  const settings = await getSettings();

  if (!settings.ok) {
    return (
      <>
        <SectionHeader titleKey="adminSettings" descriptionKey="adminSettings" />
        <ErrorState title={t("loadFailed")} />
      </>
    );
  }

  return (
    <>
      <SectionHeader titleKey="adminSettings" descriptionKey="adminSettings" />
      <SettingsView settings={settings.value} />
    </>
  );
}
