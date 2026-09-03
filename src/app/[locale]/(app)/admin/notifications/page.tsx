import { getTranslations } from "next-intl/server";

import { SectionHeader } from "@/components/layout/section";
import { ErrorState } from "@/components/shared/states";
import { NotificationRulesView } from "@/features/admin/components/notification-rules-view";
import { getEscalationPolicies, getNotificationRules } from "@/services/admin/notification-rules";
import { requireSectionAccess } from "@/services/navigation/guard";

/**
 * Règles de notification et politiques d'escalade.
 *
 * ⚠️ EN LECTURE. Ces règles décident qui est alerté et quand ; les modifier par
 * un clic éteindrait des rappels sans rien casser de visible, et le défaut ne se
 * découvrirait qu'à la première échéance manquée. Le changement passe par une
 * migration, revue et versionnée.
 *
 * L'écran existe parce que la première question posée quand une alerte n'arrive
 * pas est « la règle existe-t-elle ? ». Sans lui, il faut un accès à la base
 * pour y répondre.
 */
export default async function Page() {
  await requireSectionAccess("/admin/notifications");

  const t = await getTranslations("admin.notificationRules");
  const [rules, policies] = await Promise.all([getNotificationRules(), getEscalationPolicies()]);

  if (!rules.ok || !policies.ok) {
    return (
      <>
        <SectionHeader titleKey="adminNotifications" descriptionKey="adminNotifications" />
        <ErrorState title={t("loadFailed")} />
      </>
    );
  }

  return (
    <>
      <SectionHeader titleKey="adminNotifications" descriptionKey="adminNotifications" />
      <NotificationRulesView rules={rules.value} policies={policies.value} />
    </>
  );
}
