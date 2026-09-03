import { getTranslations } from "next-intl/server";

import { SectionHeader } from "@/components/layout/section";
import { ErrorState } from "@/components/shared/states";
import { ProfileView } from "@/features/auth/components/profile-view";
import { getAuthContext } from "@/services/auth/context";
import { getProfileLabels } from "@/services/auth/profile";
import { requireSectionAccess } from "@/services/navigation/guard";

/**
 * « Mon profil » — qui je suis, ce que je peux, et pourquoi.
 *
 * ⚠️ ÉCRAN EN LECTURE SEULE, par construction. On y voit ses rôles ; on ne les y
 * change pas. Un profil où l'on modifierait ses propres habilitations n'est plus
 * un profil, c'est une élévation de privilège.
 *
 * Il répond surtout à la question que le support entend le plus : « pourquoi je
 * ne vois pas ce dossier ? ». Rôle, domaine, échéance d'habilitation et
 * délégations reçues y répondent sans ouvrir la base.
 */
export default async function Page() {
  await requireSectionAccess("/profile");

  const t = await getTranslations("profile");
  const context = await getAuthContext();

  // `null` sans erreur signifie « pas de session » : le middleware l'aurait
  // déjà renvoyé vers la connexion, mais on ne rend jamais une page à moitié.
  if (!context.ok || context.value === null) {
    return (
      <>
        <SectionHeader titleKey="profile" descriptionKey="profile" />
        <ErrorState title={t("loadFailed")} />
      </>
    );
  }

  const labels = await getProfileLabels(context.value.profile.departmentId);

  return (
    <>
      <SectionHeader titleKey="profile" descriptionKey="profile" />
      <ProfileView
        context={context.value}
        domainLabels={labels.ok ? labels.value.domains : new Map()}
        roleLabels={labels.ok ? labels.value.roles : new Map()}
        departmentName={labels.ok ? labels.value.departmentName : null}
      />
    </>
  );
}
