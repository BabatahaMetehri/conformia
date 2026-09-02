import { SectionHeader } from "@/components/layout/section";
import { NotificationCenter, PreferencesForm } from "@/features/notifications";
import { requireSectionAccess } from "@/services/navigation/guard";

/**
 * Centre de notifications — le courrier de l'utilisateur, et ses réglages.
 *
 * ⚠️ Aucune permission n'est exigée, et c'est volontaire. Il n'y a rien à
 * cloisonner : la politique RLS ne montre à chacun que ses propres messages, et
 * tout le monde en reçoit. Exiger une permission ici priverait de ses alertes
 * quiconque n'aurait pas pensé à la lui accorder.
 */
export default async function Page() {
  await requireSectionAccess("/notifications");

  return (
    <>
      <SectionHeader titleKey="notifications" descriptionKey="notifications" />
      <div className="flex flex-col gap-6">
        <NotificationCenter />
        <PreferencesForm />
      </div>
    </>
  );
}
